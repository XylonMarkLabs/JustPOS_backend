import mongoose from "mongoose";
import { deleteImage } from "../config/cloudinary.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";

const getProductscashier = async (req, res) => {
    try {
        // Only batches that still have stock available to sell
        const stockItems = await stockItemModel
            .find({ quantityRemaining: { $gt: 0 } })
            .lean();

        // Group batches by product + selling price. Two rows for the same
        // product at the same price become one cashier-facing entry (their
        // quantities combined); a row at a different price stays separate,
        // since the cashier needs to be able to pick which price to sell at.
        const grouped = new Map();
        stockItems.forEach((item) => {
            const priceKey = Number(item.sellingPrice).toFixed(2);
            const key = `${item.productId}_${priceKey}`;

            if (!grouped.has(key)) {
                grouped.set(key, {
                    productId: item.productId,
                    sellingPrice: Number(item.sellingPrice),
                    quantityAvailable: 0,
                });
            }
            grouped.get(key).quantityAvailable += item.quantityRemaining;
        });

        const groupedEntries = Array.from(grouped.values());

        // Look up each product's base details (name, code, category, image...)
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

        // Combine each grouped batch with its product's details. Skip
        // batches whose product is missing, inactive, or has been deleted.
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
                    discount: product.discount,
                    sellingPrice: entry.sellingPrice,
                    quantityAvailable: entry.quantityAvailable,
                };
            })
            .filter(Boolean);

        res.status(200).json({ success: true, products: cashierProducts });
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
      minStock,
      imageURL,
      imagePublicId,
    } = req.body;

    // Check for existing productCode
    const existingProduct = await productModel.findOne({ productCode });
    if (existingProduct) {
      return res.status(400).json({ success: false, message: 'Product code already exists' });
    }

    const newProduct = new productModel({
      productName,
      productCode,
      category,
      minStock,
      imageURL,
      imagePublicId,
    });

    await newProduct.save();

    res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });

  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).json({ success: false, message: 'Server error while adding product' });
  }
};

const editProduct = async (req, res) => {
  try {
    const {
      productName,
      productCode,
      category,
      minStock,
      imageURL,
      imagePublicId,
      discount
    } = req.body;

    // Check for existing productCode
    await productModel.findOneAndUpdate({ productCode: productCode }, {
      productName: productName,
      category: category,
      minStock: minStock,
      imageURL: imageURL,
      imagePublicId: imagePublicId,
      discount: discount
    });

    res.status(201).json({ success: true, message: 'Product edited successfully' });

  } catch (error) {
    console.error('Error editing product:', error);
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

export { getProductscashier, addProduct, editProduct, updateProductStatus, getProducts, updateStockLevel, deleteProduct, deleteImageFromCloudinary };
