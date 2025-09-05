import categoryModel from "../models/categoryModel.js";

const addCategory = async (req, res) => {
    const { categoryName, description } = req.body;
    try {
        const existingCategory = await categoryModel.findOne({ categoryName });
        if (existingCategory) {
            return res.status(400).json({ success: false, message: "Category name already exists" });
        }
        const newCategory = new categoryModel({
            categoryName,
            description
        });
        await newCategory.save();
        res.status(201).json({ success: true, message: "Category added successfully", category: newCategory });
    } catch (error) {
        console.error("Error adding category:", error);
        res.status(500).json({ success: false, message: "Server error while adding category" });
    }
};

const getCategories = async (req, res) => {
    try {
        const categories = await categoryModel.find();
        res.status(200).json({ success: true, categories });
    } catch (error) {
        console.error("Error fetching categories:", error);
        res.status(500).json({ success: false, message: "Server error while fetching categories" });
    }
};

const updateCategoryStatus = async (req, res) => {
  try {
    const { categoryName, status } = req.body;

    const category = await categoryModel.findOneAndUpdate({ categoryName }, { status: status });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, message: 'Category status updated successfully' });

  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: 'Server error while updating product status' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { categoryName } = req.body;

    // Find the category first
    const category = await categoryModel.findOne({ categoryName });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Delete the category from DB
    await categoryModel.findOneAndDelete({ categoryName });

    res.status(200).json({ success: true, message: 'Category deleted successfully' });

  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting product' });
  }
};

export { addCategory, getCategories, updateCategoryStatus, deleteCategory };