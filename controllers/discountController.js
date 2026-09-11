import discountModel from '../models/discountModel.js'
import productModel from '../models/productModel.js'
import stockItemModel from '../models/stockItemModal.js'
import cron from 'node-cron'

const generateDiscountId = async () => {
    const last = await discountModel.findOne().sort({ createdAt: -1 }).lean()
    if (!last || !last.discountId) return 'DIS0001'
    const lastNum = parseInt(last.discountId.replace('DIS', ''), 10) || 0
    const nextNum = (lastNum + 1).toString().padStart(4, '0')
    return `DIS${nextNum}`
}

const computeStatus = (startDate, endDate, manualStatus) => {
    const now = new Date()
    if (new Date(endDate) < now) return 'expired'
    if (manualStatus === 'inactive') return 'inactive'
    if (new Date(startDate) > now) return 'scheduled'
    return 'active'
}

const validateDiscountPayload = ({ discountType, discountValue, quantity, startDate, endDate }, sellingPrice, availableQty) => {
    const errors = []

    if (!['percentage', 'fixed'].includes(discountType)) {
        errors.push('discountType must be either "percentage" or "fixed"')
    }
    if (typeof discountValue !== 'number' || discountValue <= 0) {
        errors.push('discountValue must be a positive number')
    }
    if (discountType === 'percentage' && (discountValue <= 0 || discountValue > 100)) {
        errors.push('percentage discountValue must be between 0 and 100')
    }
    if (discountType === 'fixed' && sellingPrice !== undefined && discountValue >= sellingPrice) {
        errors.push('fixed discountValue must be less than the item\'s selling price')
    }
    if (typeof quantity !== 'number' || quantity <= 0) {
        errors.push('quantity must be a positive number')
    }
    if (availableQty !== undefined && quantity > availableQty) {
        errors.push(`quantity (${quantity}) exceeds available stock item quantity (${availableQty})`)
    }
    if (!startDate || !endDate) {
        errors.push('startDate and endDate are required')
    } else if (new Date(startDate) >= new Date(endDate)) {
        errors.push('startDate must be before endDate')
    }

    return errors
}

// checks for another non-expired/inactive discount on the same stock item
// whose date range overlaps the requested one
const hasOverlappingDiscount = async (stockItemId, startDate, endDate, excludeDiscountId = null) => {
    const query = {
        stockItemId,
        status: { $in: ['scheduled', 'active'] },
        startDate: { $lte: endDate },
        endDate: { $gte: startDate },
    }
    if (excludeDiscountId) query.discountId = { $ne: excludeDiscountId }

    const overlap = await discountModel.findOne(query).lean()
    return !!overlap
}

export const expireStaleDiscounts = async (filter = {}) => {
    const now = new Date()

    // Mark discounts as expired if their end date has passed
    await discountModel.updateMany(
        {
            ...filter,
            endDate: { $lt: now },
            status: { $ne: 'expired' }
        },
        { $set: { status: 'expired' } }
    )

    // Activate scheduled discounts that have started but have not ended
    await discountModel.updateMany(
        {
            ...filter,
            startDate: { $lte: now },
            endDate: { $gte: now },
            status: 'scheduled'
        },
        { $set: { status: 'active' } }
    )
}

// Runs every minute to keep discount statuses up to date.
// For a POS system, you can use '*/5 * * * *' to run every 5 minutes
// if a few minutes of delay when activating a discount is acceptable.
export const startDiscountStatusJob = () => {
    cron.schedule('* * * * *', async () => {
        try {
            await expireStaleDiscounts()
        } catch (error) {
            console.error('discount status sync job error:', error)
        }
    })
    console.log('Discount status sync job started (runs every minute)')
}

// ---------- controllers ----------

// POST /discounts
export const addDiscount = async (req, res) => {
    try {
        const { productId, stockItemId, discountType, discountValue, quantity, startDate, endDate } = req.body

        if (!productId || !stockItemId) {
            return res.status(400).json({ success: false, message: 'productId and stockItemId are required' })
        }

        const stockItem = await stockItemModel.findOne({ _id: stockItemId })
        if (!stockItem) {
            return res.status(404).json({ success: false, message: 'Stock item not found' })
        }

        const errors = validateDiscountPayload(
            { discountType, discountValue, quantity, startDate, endDate },
            stockItem.sellingPrice,
            stockItem.quantityRemaining
        )
        if (errors.length) {
            return res.status(400).json({ success: false, message: errors.join(', ') })
        }

        const overlapping = await hasOverlappingDiscount(stockItemId, startDate, endDate)
        if (overlapping) {
            return res.status(409).json({ success: false, message: 'An active or scheduled discount already exists for this stock item in the given date range' })
        }

        const discountId = await generateDiscountId()
        const status = computeStatus(startDate, endDate)

        const discount = await discountModel.create({
            discountId,
            productId,
            stockItemId,
            discountType,
            discountValue,
            quantity,
            remainingQuantity: quantity,
            startDate,
            endDate,
            status,
        })

        return res.status(201).json({ success: true, message: 'Discount created', data: discount })
    } catch (error) {
        console.error('addDiscount error:', error)
        return res.status(500).json({ success: false, message: 'Failed to create discount', error: error.message })
    }
}

// PUT /discounts/edit
export const editDiscount = async (req, res) => {
    try {
        const { discountId, discountType, discountValue, quantity, startDate, endDate } = req.body

        const discount = await discountModel.findOne({ discountId })
        if (!discount) {
            return res.status(404).json({ success: false, message: 'Discount not found' })
        }
        if (discount.status === 'expired') {
            return res.status(400).json({ success: false, message: 'Cannot edit an expired discount' })
        }

        const stockItem = await stockItemModel.findOne({ _id: discount.stockItemId })
        if (!stockItem) {
            return res.status(404).json({ success: false, message: 'Related stock item not found' })
        }

        const merged = {
            discountType: discountType ?? discount.discountType,
            discountValue: discountValue ?? discount.discountValue,
            quantity: quantity ?? discount.quantity,
            startDate: startDate ?? discount.startDate,
            endDate: endDate ?? discount.endDate,
        }

        const errors = validateDiscountPayload(merged, stockItem.sellingPrice, stockItem.quantityRemaining)
        if (errors.length) {
            return res.status(400).json({ success: false, message: errors.join(', ') })
        }

        if (merged.quantity !== discount.quantity) {
            const sold = discount.quantity - discount.remainingQuantity
            const newRemaining = merged.quantity - sold

            if (newRemaining < 0) {
                return res.status(400).json({
                    success: false,
                    message: `Quantity cannot be less than the ${sold} unit(s) already sold under this discount`,
                })
            }

            merged.remainingQuantity = newRemaining
        }

        const overlapping = await hasOverlappingDiscount(discount.stockItemId, merged.startDate, merged.endDate, discountId)
        if (overlapping) {
            return res.status(409).json({ success: false, message: 'Another active or scheduled discount overlaps this date range' })
        }

        merged.status = computeStatus(merged.startDate, merged.endDate, discount.status === 'inactive' ? 'inactive' : undefined)

        const updated = await discountModel.findOneAndUpdate(
            { discountId },
            { $set: merged },
            { new: true }
        )

        return res.status(200).json({ success: true, message: 'Discount updated', data: updated })
    } catch (error) {
        console.error('editDiscount error:', error)
        return res.status(500).json({ success: false, message: 'Failed to update discount', error: error.message })
    }
}

// POST /discounts/update-status
export const updateStatus = async (req, res) => {
    try {
        const { discountId, status } = req.body

        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ success: false, message: 'status must be "active" or "inactive" (expired is set automatically)' })
        }

        const discount = await discountModel.findOne({ discountId })
        if (!discount) {
            return res.status(404).json({ success: false, message: 'Discount not found' })
        }
        if (discount.status === 'expired') {
            return res.status(400).json({ success: false, message: 'Cannot change status of an expired discount' })
        }

        // if re-activating, recompute against current dates (could resolve to "scheduled")
        const newStatus = status === 'active'
            ? computeStatus(discount.startDate, discount.endDate)
            : 'inactive'

        const updated = await discountModel.findOneAndUpdate(
            { discountId },
            { $set: { status: newStatus } },
            { new: true }
        )

        return res.status(200).json({ success: true, message: 'Discount status updated', data: updated })
    } catch (error) {
        console.error('updateStatus error:', error)
        return res.status(500).json({ success: false, message: 'Failed to update status', error: error.message })
    }
}

// GET /discounts
export const getAllDiscounts = async (req, res) => {
    try {
        const { status, productId, stockItemId } = req.query

        await expireStaleDiscounts()

        const filter = {}
        if (status) filter.status = status
        if (productId) filter.productId = productId
        if (stockItemId) filter.stockItemId = stockItemId

        const discounts = await discountModel.find(filter).sort({ createdAt: -1 })

        const discountsWithDetails = await Promise.all(
            discounts.map(async (discount) => {
                const product = discount.productId
                    ? await productModel.findById(discount.productId).select('productName productCode')
                    : null

                const stock = discount.stockItemId
                    ? await stockItemModel.findById(discount.stockItemId).select('stockId')
                    : null

                return {
                    ...discount.toObject(),
                    productName: product?.productName || null,
                    productCode: product?.productCode || null,
                    stockId: stock?.stockId || null
                }
            })
        )

        return res.status(200).json({
            success: true,
            discounts: discountsWithDetails
        })
    } catch (error) {
        console.error('getAllDiscounts error:', error)
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch discounts',
            error: error.message
        })
    }
}

// POST /discounts/get
export const getDiscountById = async (req, res) => {
    try {
        const { discountId } = req.body
        await expireStaleDiscounts({ discountId })

        const discount = await discountModel.findOne({ discountId })
        if (!discount) {
            return res.status(404).json({ success: false, message: 'Discount not found' })
        }
        return res.status(200).json({ success: true, discount })
    } catch (error) {
        console.error('getDiscountById error:', error)
        return res.status(500).json({ success: false, message: 'Failed to fetch discount', error: error.message })
    }
}

// POST /discounts/delete
export const deleteDiscount = async (req, res) => {
    try {
        const { discountId } = req.body
        const deleted = await discountModel.findOneAndDelete({ discountId })
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Discount not found' })
        }
        return res.status(200).json({ success: true, message: 'Discount deleted', data: deleted })
    } catch (error) {
        console.error('deleteDiscount error:', error)
        return res.status(500).json({ success: false, message: 'Failed to delete discount', error: error.message })
    }
}

// ---------- used internally by other controllers (e.g. order/sale controller) ----------

// Returns the currently active discount (if any) for a stock item, and the
// discounted unit price. Call this at sale time to price an item correctly.
export const getActiveDiscountForStockItem = async (stockItemId) => {
    await expireStaleDiscounts({ stockItemId })

    const discount = await discountModel.findOne({
        stockItemId,
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
    })

    if (!discount) return null

    const stockItem = await stockItemModel.findOne({ stockItemId })
    if (!stockItem) return null

    const discountedPrice = discount.discountType === 'percentage'
        ? stockItem.sellingPrice - (stockItem.sellingPrice * discount.discountValue / 100)
        : stockItem.sellingPrice - discount.discountValue

    return {
        discount,
        originalPrice: stockItem.sellingPrice,
        discountedPrice: Math.max(discountedPrice, 0),
    }
}