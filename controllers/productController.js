import productModel from "../models/productModel.js";

const addProduct = async (req, res) => {
  try {
    const {
      productName,
      productCode,
      category,
      description,
      sellingPrice,
      quantityInStock,
      minStock,
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
      description,
      sellingPrice,
      quantityInStock,
      minStock,
    });

    await newProduct.save();

    res.status(201).json({ success: true,  message: 'Product added successfully', product: newProduct });

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
      sellingPrice,
      quantityInStock,
      minStock,
    } = req.body;

    // Check for existing productCode
    await productModel.findOneAndUpdate({ productCode: productCode}, {  
      productName: productName,
      category: category,
      sellingPrice: sellingPrice,
      quantityInStock: quantityInStock,
      minStock: minStock,
    })

    res.status(201).json({ success: true,  message: 'Product edited successfully' });

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

    await productModel.findOneAndUpdate({ productCode: productCode }, {  quantityInStock: product.quantityInStock + quantity });
    res.status(200).json({ success: true, message: 'Stock level updated successfully' });

  } catch (error) {
    console.error('Error updating stock level:', error);
    res.status(500).json({ success: false, message: 'Server error while updating stock level' });
    
  }
}

const deleteProduct = async (req, res) => {
  try {
    const { productCode } = req.body;

    const product = await productModel.findOneAndDelete({ productCode });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, message: 'Product deleted successfully' });

  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting product' });
  }
}

export { addProduct, editProduct, updateProductStatus, getProducts, updateStockLevel, deleteProduct };
