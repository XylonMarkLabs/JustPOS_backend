import productModel from '../models/productModel.js'
import stockItemModel from '../models/stockItemModal.js'

export const computeInventorySnapshot = async () => {
        // Current stock + cost value per product, summed across every batch
        // (stockItem) that product has — this is the real source of truth now,
        // not a denormalized count on the product itself.
    const stockAgg = await stockItemModel.aggregate([
        {
            $group: {
                _id: '$productId',
                totalQty: { $sum: '$quantityRemaining' },
                totalCostValue: { $sum: { $multiply: ['$quantityRemaining', '$unitCost'] } },
            },
        },
    ])

    // stockItem.productId may have been recorded as either the product's
    // _id or its productCode (see getProductsCashier for the same
    // ambiguity) — key the map by whatever string was actually stored, then
    // check both possible keys per product below.
    const stockMap = new Map()
    stockAgg.forEach((entry) => {
        stockMap.set(String(entry._id), {
            totalQty: entry.totalQty,
            totalCostValue: entry.totalCostValue,
        })
    })

    const products = await productModel.find({ status: 1 }).lean()

    const getStockFor = (product) => {
        const byId = stockMap.get(String(product._id))
        const byCode = product.productCode ? stockMap.get(product.productCode) : null
        return {
            currentStock: (byId?.totalQty || 0) + (byCode?.totalQty || 0),
            costValue: (byId?.totalCostValue || 0) + (byCode?.totalCostValue || 0),
        }
    }

    const getStatus = (currentStock, minStock) => {
        if (currentStock <= 0) return 'Out of Stock'
        if (minStock > 0 && currentStock <= minStock * 0.5) return 'Critical'
        if (minStock > 0 && currentStock <= minStock) return 'Low Stock'
        return 'In Stock'
    }

    let lowStock = 0
    let outOfStock = 0
    let totalValue = 0
    const lowStockItems = []

    products.forEach((product) => {
        const minStock = product.minStock || 0
        const { currentStock, costValue } = getStockFor(product)
        const status = getStatus(currentStock, minStock)

        totalValue += costValue

        if (status === 'Out of Stock') outOfStock += 1
        if (status === 'Low Stock' || status === 'Critical') lowStock += 1

        if (status !== 'In Stock') {
            lowStockItems.push({
                name: product.productName,
                productCode: product.productCode,
                category: product.category,
                currentStock,
                minimumStock: minStock,
                status,
            })
        }
    })

    // Worst-off items first: Out of Stock, then Critical, then Low Stock.
    const severity = { 'Out of Stock': 0, Critical: 1, 'Low Stock': 2 }
    lowStockItems.sort((a, b) => severity[a.status] - severity[b.status] || a.currentStock - b.currentStock)

    return {
        totalProducts: products.length,
        lowStock,
        outOfStock,
        totalValue,
        lowStockItems,
    }
}