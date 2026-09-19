import orderModel from '../models/orderModel.js'
import productModel from '../models/productModel.js'
import userModel from '../models/userModel.js'
import { computeInventorySnapshot } from '../utils/inventorySnapshot.js'

export const getDashboardOverview = async (req, res) => {
    try {
        const now = new Date()

        const todayStart = new Date(now)
        todayStart.setHours(0, 0, 0, 0)

        // 7-day trend window, inclusive of today
        const trendStart = new Date(now)
        trendStart.setDate(trendStart.getDate() - 6)
        trendStart.setHours(0, 0, 0, 0)

        const [orderFacets, totalProducts, totalUsers, inventorySnapshot] = await Promise.all([
            orderModel.aggregate([
                {
                    $facet: {
                        today: [
                            { $match: { date: { $gte: todayStart } } },
                            {
                                $group: {
                                    _id: null,
                                    revenue: { $sum: '$totalAmount' },
                                    orders: { $sum: 1 },
                                },
                            },
                        ],
                        recentOrders: [
                            { $sort: { date: -1 } },
                            { $limit: 8 },
                            {
                                $project: {
                                    orderId: 1,
                                    username: 1,
                                    totalAmount: 1,
                                    paymentMethod: 1,
                                    date: 1,
                                    itemCount: { $size: '$items' },
                                },
                            },
                        ],
                        trend: [
                            { $match: { date: { $gte: trendStart } } },
                            {
                                $group: {
                                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
                                    revenue: { $sum: '$totalAmount' },
                                },
                            },
                        ],
                        topProducts: [
                            { $match: { date: { $gte: trendStart } } },
                            { $unwind: '$items' },
                            {
                                $group: {
                                    _id: '$items.productCode',
                                    name: { $first: '$items.name' },
                                    unitsSold: { $sum: '$items.quantity' },
                                    revenue: { $sum: '$items.subtotal' },
                                },
                            },
                            { $sort: { revenue: -1 } },
                            { $limit: 5 },
                        ],
                    },
                },
            ]),
            productModel.countDocuments({ status: 1 }),
            userModel.countDocuments({}),
            computeInventorySnapshot(),
        ])

        const facets = orderFacets[0] || {}
        const today = facets.today?.[0] || { revenue: 0, orders: 0 }
        const recentOrders = facets.recentOrders || []
        const topProducts = (facets.topProducts || []).map((p) => ({
            productCode: p._id,
            name: p.name,
            unitsSold: p.unitsSold,
            revenue: p.revenue,
        }))

        const trendMap = new Map((facets.trend || []).map((t) => [t._id, t.revenue]))
        const salesTrend = []
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            const key = d.toISOString().slice(0, 10)
            salesTrend.push({ date: key, revenue: trendMap.get(key) || 0 })
        }

        res.status(200).json({
            success: true,
            overview: {
                todayRevenue: today.revenue,
                todayOrders: today.orders,
                totalProducts,
                totalUsers,
                lowStock: inventorySnapshot.lowStock,
                outOfStock: inventorySnapshot.outOfStock,
                lowStockItems: inventorySnapshot.lowStockItems.slice(0, 5),
                recentOrders,
                topProducts,
                salesTrend,
            },
        })
    } catch (error) {
        console.error('Error generating dashboard overview:', error)
        res.status(500).json({ success: false, message: 'Server error while generating dashboard overview' })
    }
}