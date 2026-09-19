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

const validateDiscountPayload = ({ discountType, discountValue, quantity, startDate, endDate }, referencePrice, availableQty) => {
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
    if (discountType === 'fixed' && referencePrice !== undefined && discountValue >= referencePrice) {
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

const hasOverlappingDiscount = async (scope, startDate, endDate, excludeDiscountId = null) => {
    const query = {
        ...scope,
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

    await discountModel.updateMany(
        {
            ...filter,
            endDate: { $lt: now },
            status: { $ne: 'expired' }
        },
        { $set: { status: 'expired' } }
    )

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

export const addDiscount = async (req, res) => {
    try {
        const { productId, stockItemId, discountType, discountValue, quantity, startDate, endDate } = req.body

        if (!productId) {
            return res.status(400).json({ success: false, message: 'productId is required' })
        }

        const product = await productModel.findOne({ _id: productId })
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' })
        }

        let referencePrice
        let availableQty
        let scope

        if (product.productType === 'INVENTORY') {
            if (!stockItemId) {
                return res.status(400).json({ success: false, message: 'stockItemId is required for inventory products' })
            }

            const stockItem = await stockItemModel.findOne({ _id: stockItemId })
            if (!stockItem) {
                return res.status(404).json({ success: false, message: 'Stock item not found' })
            }

            referencePrice = stockItem.sellingPrice
            availableQty = stockItem.quantityRemaining
            scope = { stockItemId }
        } else {
            referencePrice = product.sellingPrice
            availableQty = undefined
            scope = { productId: String(product._id), stockItemId: null }
        }

        const errors = validateDiscountPayload(
            { discountType, discountValue, quantity, startDate, endDate },
            referencePrice,
            availableQty
        )
        if (errors.length) {
            return res.status(400).json({ success: false, message: errors.join(', ') })
        }

        const overlapping = await hasOverlappingDiscount(scope, startDate, endDate)
        if (overlapping) {
            return res.status(409).json({
                success: false,
                message: product.productType === 'INVENTORY'
                    ? 'An active or scheduled discount already exists for this stock item in the given date range'
                    : 'An active or scheduled discount already exists for this product in the given date range',
            })
        }

        const discountId = await generateDiscountId()
        const status = computeStatus(startDate, endDate)

        const discount = await discountModel.create({
            discountId,
            productId,
            stockItemId: scope.stockItemId ?? null,
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

        let referencePrice
        let availableQty

        if (discount.stockItemId) {
            const stockItem = await stockItemModel.findOne({ _id: discount.stockItemId })
            if (!stockItem) {
                return res.status(404).json({ success: false, message: 'Related stock item not found' })
            }
            referencePrice = stockItem.sellingPrice
            availableQty = stockItem.quantityRemaining
        } else {
            const product = await productModel.findOne({ _id: discount.productId })
            if (!product) {
                return res.status(404).json({ success: false, message: 'Related product not found' })
            }
            referencePrice = product.sellingPrice
            availableQty = undefined
        }

        const merged = {
            discountType: discountType ?? discount.discountType,
            discountValue: discountValue ?? discount.discountValue,
            quantity: quantity ?? discount.quantity,
            startDate: startDate ?? discount.startDate,
            endDate: endDate ?? discount.endDate,
        }

        const errors = validateDiscountPayload(merged, referencePrice, availableQty)
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

        const scope = discount.stockItemId
            ? { stockItemId: discount.stockItemId }
            : { productId: discount.productId, stockItemId: null }

        const overlapping = await hasOverlappingDiscount(scope, merged.startDate, merged.endDate, discountId)
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
                    ? await productModel.findById(discount.productId).select('productName productCode productType')
                    : null

                const stock = discount.stockItemId
                    ? await stockItemModel.findById(discount.stockItemId).select('stockId')
                    : null

                return {
                    ...discount.toObject(),
                    productName: product?.productName || null,
                    productCode: product?.productCode || null,
                    productType: product?.productType || null,
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

// ---------- used internally by other controllers (e.g. cashier/cart/order) ----------

// INVENTORY: active discount (if any) for a specific stock batch.
export const getActiveDiscountForStockItem = async (stockItemId) => {
    await expireStaleDiscounts({ stockItemId })

    const discount = await discountModel.findOne({
        stockItemId,
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
        remainingQuantity: { $gt: 0 },
    })

    if (!discount) return null

    const stockItem = await stockItemModel.findOne({ _id: stockItemId })
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

export const getActiveDiscountForProduct = async (productId) => {
    await expireStaleDiscounts({ productId: String(productId), stockItemId: null })

    const discount = await discountModel.findOne({
        productId: String(productId),
        stockItemId: null,
        status: 'active',
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
        remainingQuantity: { $gt: 0 },
    })

    if (!discount) return null

    const product = await productModel.findOne({ _id: productId })
    if (!product) return null

    const discountedPrice = discount.discountType === 'percentage'
        ? product.sellingPrice - (product.sellingPrice * discount.discountValue / 100)
        : product.sellingPrice - discount.discountValue

    return {
        discount,
        originalPrice: product.sellingPrice,
        discountedPrice: Math.max(discountedPrice, 0),
    }
}