import mongoose from "mongoose";
import { deleteImage } from "../config/cloudinary.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";
import discountModel from "../models/discountModel.js";

const getProductsCashier = async (req, res) => {
    try {
        const stockItems = await stockItemModel
            .find({ quantityRemaining: { $gt: 0 } })
            .lean();

        const stockItemIds = stockItems.map((item) => String(item._id));

        const now = new Date();
        const activeDiscounts = await discountModel
            .find({
                stockItemId: { $in: stockItemIds },
                status: 'active',
                startDate: { $lte: now },
                endDate: { $gte: now },
                remainingQuantity: { $gt: 0 },
            })
            .lean();

        const discountByStockItem = new Map();
        activeDiscounts.forEach((discount) => {
            discountByStockItem.set(String(discount.stockItemId), discount);
        });

        const grouped = new Map();

        const addToGroup = (key, base, stockItemId, qty) => {
            if (qty <= 0) return;
            if (!grouped.has(key)) {
                grouped.set(key, { ...base, quantityAvailable: 0, stockItems: [] });
            }
            const group = grouped.get(key);
            group.quantityAvailable += qty;
            group.stockItems.push({ stockItemId, quantityAvailable: qty });
        };

        stockItems.forEach((item) => {
            const stockItemId = String(item._id);
            const discount = discountByStockItem.get(stockItemId);
            const originalPrice = Number(item.sellingPrice);

            if (!discount) {
                const priceKey = originalPrice.toFixed(2);
                addToGroup(`${item.productId}_${priceKey}`, {
                    productId: item.productId,
                    sellingPrice: originalPrice,
                    originalPrice,
                    discountId: null,
                    discount: null,
                }, stockItemId, item.quantityRemaining);
                return;
            }

            const discountedQty = Math.min(item.quantityRemaining, discount.remainingQuantity);
            const plainQty = item.quantityRemaining - discountedQty;

            const discountedPrice = discount.discountType === 'percentage'
                ? originalPrice - (originalPrice * discount.discountValue) / 100
                : originalPrice - discount.discountValue;

            addToGroup(`${item.productId}_disc_${discount.discountId}`, {
                productId: item.productId,
                sellingPrice: Math.max(discountedPrice, 0),
                originalPrice,
                discountId: discount.discountId,
                discount: {
                    discountId: discount.discountId,
                    discountType: discount.discountType,
                    discountValue: discount.discountValue,
                },
            }, stockItemId, discountedQty);

            if (plainQty > 0) {
                const priceKey = originalPrice.toFixed(2);
                addToGroup(`${item.productId}_${priceKey}`, {
                    productId: item.productId,
                    sellingPrice: originalPrice,
                    originalPrice,
                    discountId: null,
                    discount: null,
                }, stockItemId, plainQty);
            }
        });

        const groupedEntries = Array.from(grouped.values());

        const productIds = [...new Set(groupedEntries.map((entry) => entry.productId))];
        const objectIdCandidates = productIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const codeCandidates = productIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));

        const products = await productModel.find({
            $or: [
                { _id: { $in: objectIdCandidates } },
                { productCode: { $in: codeCandidates } }
            ]
        }).lean();

        const productLookup = new Map();
        products.forEach((product) => {
            productLookup.set(String(product._id), product);
            if (product.productCode) productLookup.set(product.productCode, product);
        });

        const cashierProducts = groupedEntries
            .map((entry) => {
                const product = productLookup.get(String(entry.productId));
                if (!product) return null;
                if (product.status !== 1) return null;

                return {
                    productId: entry.productId,
                    productName: product.productName,
                    productCode: product.productCode,
                    category: product.category,
                    imageURL: product.imageURL,
                    productType: product.productType,
                    sellingPrice: entry.sellingPrice,
                    originalPrice: entry.originalPrice,
                    discountId: entry.discountId,
                    discount: entry.discount,
                    stockItems: entry.stockItems,
                    quantityAvailable: entry.quantityAvailable,
                    minStock: product.minStock || 0,
                };
            })
            .filter(Boolean);

        const nonInventoryProducts = await productModel
            .find({ productType: 'NON_INVENTORY', status: 1 })
            .lean();

        const nonInventoryProductIds = nonInventoryProducts.map((p) => String(p._id));
        const nonInventoryDiscounts = await discountModel
            .find({
                productId: { $in: nonInventoryProductIds },
                stockItemId: null,
                status: 'active',
                startDate: { $lte: now },
                endDate: { $gte: now },
                remainingQuantity: { $gt: 0 },
            })
            .lean();

        const discountByProduct = new Map();
        nonInventoryDiscounts.forEach((discount) => {
            discountByProduct.set(String(discount.productId), discount);
        });

        const nonInventoryCashierProducts = [];
        nonInventoryProducts.forEach((product) => {
            const discount = discountByProduct.get(String(product._id));
            const originalPrice = Number(product.sellingPrice);

            const baseEntry = {
                productId: String(product._id),
                productName: product.productName,
                productCode: product.productCode,
                category: product.category,
                imageURL: product.imageURL,
                productType: product.productType,
                stockItems: [],
                minStock: 0,
            };

            if (!discount) {
                nonInventoryCashierProducts.push({
                    ...baseEntry,
                    sellingPrice: originalPrice,
                    originalPrice,
                    discountId: null,
                    discount: null,
                    quantityAvailable: null,
                });
                return;
            }

            const discountedPrice = discount.discountType === 'percentage'
                ? originalPrice - (originalPrice * discount.discountValue) / 100
                : originalPrice - discount.discountValue;

            nonInventoryCashierProducts.push({
                ...baseEntry,
                sellingPrice: Math.max(discountedPrice, 0),
                originalPrice,
                discountId: discount.discountId,
                discount: {
                    discountId: discount.discountId,
                    discountType: discount.discountType,
                    discountValue: discount.discountValue,
                },
                quantityAvailable: discount.remainingQuantity,
            });

            nonInventoryCashierProducts.push({
                ...baseEntry,
                sellingPrice: originalPrice,
                originalPrice,
                discountId: null,
                discount: null,
                quantityAvailable: null,
            });
        });

        res.status(200).json({
            success: true,
            products: [...cashierProducts, ...nonInventoryCashierProducts],
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching products' });
    }
};

const addProduct = async (req, res) => {
  try {
    const {
      productName,
      productCode,
      category,
      productType,
      taxRate,
      minStock,
      sellingPrice,
      costPrice,
      imageURL,
      imagePublicId,
    } = req.body;

    if (!['INVENTORY', 'NON_INVENTORY'].includes(productType)) {
      return res.status(400).json({
        success: false,
        message: 'productType must be either "INVENTORY" or "NON_INVENTORY"',
      });
    }

    // Check for existing productCode
    const existingProduct = await productModel.findOne({ productCode });
    if (existingProduct) {
      return res.status(400).json({ success: false, message: 'Product code already exists' });
    }

    const newProduct = new productModel({
      productName,
      productCode,
      category,
      productType,
      taxRate,
      minStock: productType === 'INVENTORY' ? minStock : undefined,
      sellingPrice: productType === 'NON_INVENTORY' ? sellingPrice : undefined,
      costPrice: productType === 'NON_INVENTORY' ? costPrice : undefined,
      imageURL,
      imagePublicId,
    });

    await newProduct.save();

    res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });

  } catch (error) {
    console.error('Error adding product:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors).map((e) => e.message).join(', '),
      });
    }
    res.status(500).json({ success: false, message: 'Server error while adding product' });
  }
};

const editProduct = async (req, res) => {
  try {
    const {
      productName,
      productCode,
      category,
      productType,
      taxRate,
      minStock,
      sellingPrice,
      costPrice,
      imageURL,
      imagePublicId,
    } = req.body;

    const product = await productModel.findOne({ productCode });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (productType === 'NON_INVENTORY' && product.productType === 'INVENTORY') {
      const hasStockItems = await stockItemModel.exists({
        $or: [{ productId: String(product._id) }, { productId: product.productCode }],
      });
      if (hasStockItems) {
        return res.status(400).json({
          success: false,
          message: 'This product still has stock batches recorded against it — cannot convert it to a non-inventory (made-to-order) product.',
        });
      }
    }

    if (productName !== undefined) product.productName = productName;
    if (category !== undefined) product.category = category;
    if (taxRate !== undefined) product.taxRate = taxRate;
    if (imageURL !== undefined) product.imageURL = imageURL;
    if (imagePublicId !== undefined) product.imagePublicId = imagePublicId;
    if (productType !== undefined) product.productType = productType;
    if (minStock !== undefined) product.minStock = minStock;
    if (sellingPrice !== undefined) product.sellingPrice = sellingPrice;
    if (costPrice !== undefined) product.costPrice = costPrice;

    await product.save();

    res.status(200).json({ success: true, message: 'Product edited successfully', product });

  } catch (error) {
    console.error('Error editing product:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: Object.values(error.errors).map((e) => e.message).join(', '),
      });
    }
    res.status(500).json({ success: false, message: 'Server error while editing product' });
  }
};

const updateProductStatus = async (req, res) => {
  try {
    const { productCode, status } = req.body;

    const product = await productModel.findOneAndUpdate({ productCode }, { status: status });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, message: 'Product status updated successfully' });

  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: 'Server error while updating product status' });
  }
};

const getProducts = async (req, res) => {
  try {
    const products = await productModel.find({});
    res.status(200).json({ success: true, products });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: 'Server error while fetching products' });
  }
};

const updateStockLevel = async (req, res) => {
  const { productCode, quantity } = req.body;
  try {
    const product = await productModel.findOne({ productCode: productCode });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    if (product.productType !== 'INVENTORY') {
      return res.status(400).json({
        success: false,
        message: 'Only inventory products have a stock level to update',
      });
    }

    await productModel.findOneAndUpdate({ productCode: productCode }, { quantityInStock: product.quantityInStock + quantity });
    res.status(200).json({ success: true, message: 'Stock level updated successfully' });

  } catch (error) {
    console.error('Error updating stock level:', error);
    res.status(500).json({ success: false, message: 'Server error while updating stock level' });

  }
}

const deleteProduct = async (req, res) => {
  try {
    const { productCode } = req.body;

    // Find the product first
    const product = await productModel.findOne({ productCode });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Delete associated image from Cloudinary if exists
    if (product.imagePublicId) {
      const deleteResult = await deleteImage(product.imagePublicId);

      if (deleteResult.error) {
        console.error('Error deleting image from Cloudinary:', deleteResult.error);
      }
    }

    // Delete the product from DB
    await productModel.findOneAndDelete({ productCode });

    res.status(200).json({ success: true, message: 'Product deleted successfully' });

  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting product' });
  }
};

const deleteImageFromCloudinary = async (req, res) => {
  const { publicId } = req.body;

  const result = await deleteImage(publicId)

  if (result.success === false) {
    return res.status(500).json({ error: result.error || result.message });
  }

  return res.status(200).json({ success: true, message: result.message });

}

export { getProductsCashier, addProduct, editProduct, updateProductStatus, getProducts, updateStockLevel, deleteProduct, deleteImageFromCloudinary };