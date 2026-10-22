import mongoose from "mongoose";
import validator from "validator";
import { deleteImage } from "../config/cloudinary.js";
import { codeValidator, categoryNameValidator, productCodeValidator } from "../middleware/inputValidator.js";
import productModel from "../models/productModel.js";
import stockItemModel from "../models/stockItemModal.js";
import discountModel from "../models/discountModel.js";
import { logger } from "../utils/logger.js";

const PRODUCT_TYPES = ['INVENTORY', 'NON_INVENTORY'];

const badRequest = (res, message) =>
  res.status(400).json({ success: false, message });

// Run several validators in order and return the first error message (or null).
const firstError = (...errors) => errors.find(Boolean) || null;

// The acting user comes from requireAuth (server-side), never from the request body.
const actorOf = (req) => String(req.user._id);

// Only log a product code if it is a plain numeric code (what the validator allows).
const safeCode = (req) => {
  const code = req.body?.productCode;
  return typeof code === 'string' && /^\d{1,20}$/.test(code) ? code : null;
};

// Validation failure: log it (expected, so "warn") and send the usual 400.
// `message` is the validator's own static text, never user input.
const invalid = (req, res, operation, message) => {
  logger.warn(
    { event: 'PRODUCT_VALIDATION_FAILED', operation, detail: message, actorUserId: actorOf(req) },
    'Product request failed validation'
  );
  return badRequest(res, message);
};

const notFound = (req, res, operation, productCode) => {
  logger.warn(
    { event: 'PRODUCT_OPERATION_FAILED', operation, reason: 'PRODUCT_NOT_FOUND', productCode, actorUserId: actorOf(req) },
    'Product not found'
  );
  return res.status(404).json({ success: false, message: 'Product not found' });
};

const productNameValidator = (name) => {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'Product name is required and must be a string';
  }
  if (name.length > 100) {
    return 'Product name must be at most 100 characters';
  }
  return null;
};

const productTypeValidator = (productType) => {
  if (!PRODUCT_TYPES.includes(productType)) {
    return 'productType must be either "INVENTORY" or "NON_INVENTORY"';
  }
  return null;
};

// Numeric fields (prices, tax, stock levels). Accepts a number OR a numeric
// string (HTML forms often send "10.50"), but never objects/arrays/booleans.
const numberValidator = (value, label, { min = 0, max = 1e9, integer = false } = {}) => {
  const isNumeric =
    (typeof value === 'number') ||
    (typeof value === 'string' && value.trim() !== '');
  const num = isNumeric ? Number(value) : NaN;

  if (!Number.isFinite(num)) {
    return `${label} must be a valid number`;
  }
  if (integer && !Number.isInteger(num)) {
    return `${label} must be a whole number`;
  }
  if (num < min || num > max) {
    return `${label} must be between ${min} and ${max}`;
  }
  return null;
};

// Cloudinary public IDs can contain folders ("products/abc123"), so "/" and
// "." are allowed here, unlike the default codeValidator pattern.
const publicIdValidator = (publicId) =>
  codeValidator(publicId, 'Image public ID', {
    maxLength: 200,
    pattern: /^[a-zA-Z0-9_\-\/.]+$/,
  });

const imageURLValidator = (url) => {
  if (typeof url !== 'string' || url.length > 500) {
    return 'Image URL must be a string of at most 500 characters';
  }
  if (!validator.isURL(url, { protocols: ['http', 'https'], require_protocol: true })) {
    return 'Image URL is not valid';
  }
  return null;
};

// Product status: 1 = active (see getProductsCashier / addToCart), 0 = inactive.
const productStatusValidator = (status) => {
  if (![0, 1].includes(status)) {
    return 'Status must be 0 or 1';
  }
  return null;
};

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
    logger.error({ event: 'PRODUCT_QUERY_ERROR', operation: 'getProductsCashier', err: error }, 'Error fetching products');
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

    // --- validate required fields ---
    const requiredError = firstError(
      productTypeValidator(productType),
      productNameValidator(productName),
      productCodeValidator(productCode),
      categoryNameValidator(category),
    );
    if (requiredError) return invalid(req, res, 'create', requiredError);

    // --- validate optional fields (only if sent) ---
    const optionalError = firstError(
      taxRate !== undefined ? numberValidator(taxRate, 'Tax rate', { max: 100 }) : null,
      minStock !== undefined ? numberValidator(minStock, 'Minimum stock', { integer: true }) : null,
      sellingPrice !== undefined ? numberValidator(sellingPrice, 'Selling price') : null,
      costPrice !== undefined ? numberValidator(costPrice, 'Cost price') : null,
      imageURL !== undefined ? imageURLValidator(imageURL) : null,
      imagePublicId !== undefined ? publicIdValidator(imagePublicId) : null,
    );
    if (optionalError) return invalid(req, res, 'create', optionalError);

    // Check for existing productCode
    const existingProduct = await productModel.findOne({ productCode });
    if (existingProduct) {
      logger.warn(
        { event: 'PRODUCT_DUPLICATE_CODE', operation: 'create', productCode, actorUserId: actorOf(req) },
        'Product code already exists'
      );
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

    logger.info(
      { event: 'PRODUCT_CREATED', actorUserId: actorOf(req), productId: String(newProduct._id), productCode, productType },
      'Product created'
    );

    res.status(201).json({ success: true, message: 'Product added successfully', product: newProduct });

  } catch (error) {
    if (error.name === 'ValidationError') {
      const detail = Object.values(error.errors).map((e) => e.message).join(', ');
      logger.warn(
        { event: 'PRODUCT_VALIDATION_FAILED', operation: 'create', reason: 'SCHEMA_VALIDATION', detail, actorUserId: actorOf(req) },
        'Product failed schema validation'
      );
      return res.status(400).json({
        success: false,
        message: detail,
      });
    }
    if (error.code === 11000) {
      // two requests raced past the duplicate check and hit the unique index
      logger.warn(
        { event: 'PRODUCT_DUPLICATE_CODE', operation: 'create', productCode: safeCode(req), actorUserId: actorOf(req) },
        'Product code already exists (unique index)'
      );
    } else {
      logger.error(
        { event: 'PRODUCT_OPERATION_ERROR', operation: 'create', actorUserId: actorOf(req), err: error },
        'Unexpected error adding product'
      );
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

    // productCode identifies the product, so it is required
    const codeError = productCodeValidator(productCode);
    if (codeError) return invalid(req, res, 'update', codeError);

    // every other field is optional, but must be valid if sent
    const optionalError = firstError(
      productName !== undefined ? productNameValidator(productName) : null,
      category !== undefined ? categoryNameValidator(category) : null,
      productType !== undefined ? productTypeValidator(productType) : null,
      taxRate !== undefined ? numberValidator(taxRate, 'Tax rate', { max: 100 }) : null,
      minStock !== undefined ? numberValidator(minStock, 'Minimum stock', { integer: true }) : null,
      sellingPrice !== undefined ? numberValidator(sellingPrice, 'Selling price') : null,
      costPrice !== undefined ? numberValidator(costPrice, 'Cost price') : null,
      // empty string is allowed for the image fields so an image can be cleared
      imageURL !== undefined && imageURL !== '' ? imageURLValidator(imageURL) : null,
      imagePublicId !== undefined && imagePublicId !== '' ? publicIdValidator(imagePublicId) : null,
    );
    if (optionalError) return invalid(req, res, 'update', optionalError);

    const product = await productModel.findOne({ productCode });
    if (!product) {
      return notFound(req, res, 'update', productCode);
    }

    if (productType === 'NON_INVENTORY' && product.productType === 'INVENTORY') {
      const hasStockItems = await stockItemModel.exists({
        $or: [{ productId: String(product._id) }, { productId: product.productCode }],
      });
      if (hasStockItems) {
        logger.warn(
          {
            event: 'PRODUCT_OPERATION_FAILED',
            operation: 'update',
            reason: 'HAS_STOCK_BATCHES',
            productId: String(product._id),
            productCode,
            actorUserId: actorOf(req),
          },
          'Refused to convert a product that still has stock batches'
        );
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

    // Mongoose only marks a field as modified when its value really changed.
    // Field NAMES only are logged, never values.
    const changedFields = product.modifiedPaths();

    await product.save();

    if (changedFields.length > 0) {
      logger.info(
        { event: 'PRODUCT_UPDATED', actorUserId: actorOf(req), productId: String(product._id), productCode, changedFields },
        'Product updated'
      );
    }

    res.status(200).json({ success: true, message: 'Product edited successfully', product });

  } catch (error) {
    if (error.name === 'ValidationError') {
      const detail = Object.values(error.errors).map((e) => e.message).join(', ');
      logger.warn(
        { event: 'PRODUCT_VALIDATION_FAILED', operation: 'update', reason: 'SCHEMA_VALIDATION', detail, actorUserId: actorOf(req) },
        'Product failed schema validation'
      );
      return res.status(400).json({
        success: false,
        message: detail,
      });
    }
    logger.error(
      { event: 'PRODUCT_OPERATION_ERROR', operation: 'update', productCode: safeCode(req), actorUserId: actorOf(req), err: error },
      'Unexpected error editing product'
    );
    res.status(500).json({ success: false, message: 'Server error while editing product' });
  }
};

const updateProductStatus = async (req, res) => {
  try {
    const { productCode, status } = req.body;

    const inputError = firstError(
      productCodeValidator(productCode),
      productStatusValidator(status),
    );
    if (inputError) return invalid(req, res, 'status', inputError);

    // findOneAndUpdate returns the document as it was BEFORE the update
    const product = await productModel.findOneAndUpdate({ productCode }, { status: status });

    if (!product) {
      return notFound(req, res, 'status', productCode);
    }

    logger.info(
      {
        event: 'PRODUCT_STATUS_CHANGED',
        actorUserId: actorOf(req),
        productId: String(product._id),
        productCode,
        previousStatus: product.status,
        newStatus: status,
      },
      status === 1 ? 'Product activated' : 'Product deactivated'
    );

    res.status(200).json({ success: true, message: 'Product status updated successfully' });

  } catch (error) {
    logger.error(
      { event: 'PRODUCT_OPERATION_ERROR', operation: 'status', productCode: safeCode(req), actorUserId: actorOf(req), err: error },
      'Unexpected error updating product status'
    );
    res.status(500).json({ success: false, message: 'Server error while updating product status' });
  }
};

const getProducts = async (req, res) => {
  try {
    const products = await productModel.find({});
    res.status(200).json({ success: true, products });
  } catch (error) {
    logger.error({ event: 'PRODUCT_QUERY_ERROR', operation: 'getProducts', err: error }, 'Error fetching products');
    res.status(500).json({ success: false, message: 'Server error while fetching products' });
  }
};

const updateStockLevel = async (req, res) => {
  const { productCode, quantity } = req.body;
  const actorUserId = actorOf(req);
  const stockFail = (reason, message, status, extra = {}) => {
    logger.warn(
      { event: 'STOCK_ADJUSTMENT_FAILED', reason, productCode: safeCode(req), actorUserId, ...extra },
      'Stock adjustment rejected'
    );
    return res.status(status).json({ success: false, message });
  };

  try {
    // quantity is an adjustment, so negative values (stock removed) are allowed
    const inputError = firstError(
      productCodeValidator(productCode),
      numberValidator(quantity, 'Quantity', { min: -1000000, max: 1000000, integer: true }),
    );
    if (inputError) return stockFail('VALIDATION_FAILED', inputError, 400, { detail: inputError });

    const adjustment = Number(quantity);

    const product = await productModel.findOne({ productCode: productCode });
    if (!product) {
      return stockFail('PRODUCT_NOT_FOUND', 'Product not found', 404);
    }

    if (product.productType !== 'INVENTORY') {
      return stockFail(
        'NOT_INVENTORY_PRODUCT',
        'Only inventory products have a stock level to update',
        400,
        { productId: String(product._id) }
      );
    }

    const previousQuantity = product.quantityInStock;
    const newStockLevel = previousQuantity + adjustment;
    if (newStockLevel < 0) {
      return stockFail(
        'WOULD_GO_NEGATIVE',
        'Stock level cannot go below zero',
        400,
        { productId: String(product._id), quantityChange: adjustment, previousQuantity }
      );
    }

    await productModel.findOneAndUpdate({ productCode: productCode }, { quantityInStock: newStockLevel });

    logger.info(
      {
        event: 'STOCK_ADJUSTED',
        actorUserId,
        productId: String(product._id),
        productCode,
        quantityChange: adjustment,
        previousQuantity,
        resultingQuantity: newStockLevel,
      },
      'Stock level adjusted'
    );

    // Alert only when this adjustment CROSSES the threshold (an actual state change),
    // so repeated adjustments while already low don't repeat the warning.
    const minStock = product.minStock || 0;
    if (previousQuantity > minStock && newStockLevel <= minStock) {
      logger.warn(
        {
          event: 'LOW_STOCK_DETECTED',
          source: 'manual_adjustment',
          productId: String(product._id),
          productCode,
          resultingQuantity: newStockLevel,
          minStock,
          outOfStock: newStockLevel === 0,
        },
        'Product stock fell to or below its minimum'
      );
    }

    res.status(200).json({ success: true, message: 'Stock level updated successfully' });

  } catch (error) {
    logger.error(
      { event: 'STOCK_ADJUSTMENT_ERROR', productCode: safeCode(req), actorUserId, err: error },
      'Unexpected error updating stock level'
    );
    res.status(500).json({ success: false, message: 'Server error while updating stock level' });

  }
}

const deleteProduct = async (req, res) => {
  try {
    const { productCode } = req.body;

    const codeError = productCodeValidator(productCode);
    if (codeError) return invalid(req, res, 'delete', codeError);

    // Find the product first
    const product = await productModel.findOne({ productCode });

    if (!product) {
      return notFound(req, res, 'delete', productCode);
    }

    // Delete associated image from Cloudinary if exists
    if (product.imagePublicId) {
      const deleteResult = await deleteImage(product.imagePublicId);

      if (deleteResult.error) {
        // The product is still deleted below, which can leave an orphaned image behind.
        logger.warn(
          { event: 'PRODUCT_IMAGE_DELETE_FAILED', productId: String(product._id), productCode, reason: deleteResult.error },
          'Could not delete product image from Cloudinary'
        );
      }
    }

    // Delete the product from DB
    await productModel.findOneAndDelete({ productCode });

    logger.info(
      {
        event: 'PRODUCT_DELETED',
        actorUserId: actorOf(req),
        productId: String(product._id),
        productCode,
        productType: product.productType,
        hadImage: Boolean(product.imagePublicId),
      },
      'Product deleted'
    );

    res.status(200).json({ success: true, message: 'Product deleted successfully' });

  } catch (error) {
    logger.error(
      { event: 'PRODUCT_OPERATION_ERROR', operation: 'delete', productCode: safeCode(req), actorUserId: actorOf(req), err: error },
      'Unexpected error deleting product'
    );
    res.status(500).json({ success: false, message: 'Server error while deleting product' });
  }
};

const deleteImageFromCloudinary = async (req, res) => {
  const { publicId } = req.body;

  try {
    const publicIdError = publicIdValidator(publicId);
    if (publicIdError) return invalid(req, res, 'delete_image', publicIdError);

    const result = await deleteImage(publicId)

    if (result.success === false) {
      logger.warn(
        { event: 'PRODUCT_IMAGE_DELETE_FAILED', actorUserId: actorOf(req), reason: result.error || result.message },
        'Could not delete image from Cloudinary'
      );
      return res.status(500).json({ error: result.error || result.message });
    }

    return res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    logger.error(
      { event: 'PRODUCT_OPERATION_ERROR', operation: 'delete_image', actorUserId: actorOf(req), err: error },
      'Unexpected error deleting image'
    );
    return res.status(500).json({ success: false, message: 'Server error while deleting image' });
  }
}

export { getProductsCashier, addProduct, editProduct, updateProductStatus, getProducts, updateStockLevel, deleteProduct, deleteImageFromCloudinary };