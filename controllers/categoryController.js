import { categoryNameValidator } from "../middleware/inputValidator.js";
import categoryModel from "../models/categoryModel.js";

const badRequest = (res, message) =>
    res.status(400).json({ success: false, message });

const descriptionValidator = (description) => {
    if (description === undefined || description === null) {
        return null;
    }
    if (typeof description !== "string") {
        return "Description must be a string";
    }
    if (description.length > 500) {
        return "Description must be at most 500 characters";
    }
    return null;
};

const categoryStatusValidator = (status) => {
    const allowed = [0, 1];
    if (!allowed.includes(status)) {
        return "Status is not valid";
    }
    return null;
};

const addCategory = async (req, res) => {
    const { categoryName, description } = req.body;
    try {
        const categoryNameError = categoryNameValidator(categoryName);
        if (categoryNameError) return badRequest(res, categoryNameError);

        const descriptionError = descriptionValidator(description);
        if (descriptionError) return badRequest(res, descriptionError);

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

    const categoryNameError = categoryNameValidator(categoryName);
    if (categoryNameError) return badRequest(res, categoryNameError);

    const statusError = categoryStatusValidator(status);
    if (statusError) return badRequest(res, statusError);

    const category = await categoryModel.findOneAndUpdate({ categoryName }, { status: status });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.status(200).json({ success: true, message: 'Category status updated successfully' });

  } catch (error) {
    console.error('Error updating category status:', error);
    res.status(500).json({ success: false, message: 'Server error while updating category status' });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const { categoryName } = req.body;

    const categoryNameError = categoryNameValidator(categoryName);
    if (categoryNameError) return badRequest(res, categoryNameError);

    // Find the category first
    const category = await categoryModel.findOne({ categoryName });

    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // Delete the category from DB
    await categoryModel.findOneAndDelete({ categoryName });

    res.status(200).json({ success: true, message: 'Category deleted successfully' });

  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ success: false, message: 'Server error while deleting category' });
  }
};

const editCategory = async (req, res) => {
    try {
        const { categoryId, categoryName, description } = req.body;

        const existingCategory = await categoryModel.findOne({
            _id: categoryId
        });

        if (!existingCategory) {
            return res.status(404).json({
                success: false,
                message: "Category not found"
            });
        }

        const duplicateCategory = await categoryModel.findOne({
            categoryName,
            _id: { $ne: existingCategory._id }
        });

        if (duplicateCategory) {
            return res.status(400).json({
                success: false,
                message: "Category name already exists"
            });
        }

        existingCategory.categoryName = categoryName;
        existingCategory.description = description;

        await existingCategory.save();

        res.status(200).json({
            success: true,
            message: "Category updated successfully",
            category: existingCategory
        });

    } catch (error) {
        console.error("Error editing category:", error);

        res.status(500).json({
            success: false,
            message: "Server error while editing category"
        });
    }
};

export { addCategory, getCategories, updateCategoryStatus, deleteCategory, editCategory };