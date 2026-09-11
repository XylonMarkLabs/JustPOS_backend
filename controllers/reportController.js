import orderModel from '../models/orderModel.js'
import { computeInventorySnapshot } from '../utils/inventorySnapshot.js'

export const getSalesReport = async (req, res) => {
    try {
        const { startDate, endDate } = req.query

        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, message: 'startDate and endDate are required' })
        }

        const start = new Date(startDate)
        const end = new Date(endDate)

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ success: false, message: 'Invalid startDate or endDate' })
        }

        // Single aggregation, split via $facet so the order-level totals
        // (sales, order count, discount given) and the item-level breakdown
        // (per-product units/revenue/profit) are computed in one round trip
        // instead of two separate queries scanning the same date range.
        const [result] = await orderModel.aggregate([
            { $match: { date: { $gte: start, $lte: end } } },
            {
                $facet: {
                    summary: [
                        {
                            $group: {
                                _id: null,
                                totalSales: { $sum: '$totalAmount' },
                                totalOrders: { $sum: 1 },
                                totalDiscountGiven: { $sum: { $ifNull: ['$discount', 0] } },
                            },
                        },
                    ],
                    itemStats: [
                        { $unwind: '$items' },
                        {
                            $group: {
                                _id: '$items.productCode',
                                name: { $first: '$items.name' },
                                unitsSold: { $sum: '$items.quantity' },
                                revenue: { $sum: '$items.subtotal' },
                                profit: {
                                    $sum: {
                                        $multiply: [
                                            { $subtract: ['$items.unitPrice', { $ifNull: ['$items.unitCost', 0] }] },
                                            '$items.quantity',
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        ])

        const summary = result?.summary?.[0] || { totalSales: 0, totalOrders: 0, totalDiscountGiven: 0 }
        const itemStats = result?.itemStats || []

        const totalProfit = itemStats.reduce((sum, item) => sum + item.profit, 0)
        const avgOrderValue = summary.totalOrders > 0 ? summary.totalSales / summary.totalOrders : 0

        const topProducts = [...itemStats]
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map((item) => ({
                productCode: item._id,
                name: item.name,
                unitsSold: item.unitsSold,
                revenue: item.revenue,
            }))

        res.status(200).json({
            success: true,
            report: {
                totalSales: summary.totalSales,
                totalOrders: summary.totalOrders,
                avgOrderValue,
                totalDiscountGiven: summary.totalDiscountGiven,
                totalProfit,
                topProducts,
            },
        })
    } catch (error) {
        console.error('Error generating sales report:', error)
        res.status(500).json({ success: false, message: 'Server error while generating sales report' })
    }
}

export const getInventoryReport = async (req, res) => {
    try {
        const snapshot = await computeInventorySnapshot()
        res.status(200).json({ success: true, report: snapshot })
    } catch (error) {
        console.error('Error generating inventory report:', error)
        res.status(500).json({ success: false, message: 'Server error while generating inventory report' })
    }
}