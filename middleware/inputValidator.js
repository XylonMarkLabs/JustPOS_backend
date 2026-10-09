import mongoose from 'mongoose';

const passwordValidator = (password) => {

    // Check if password is provided
    if (typeof password !== "string" || password.length === 0) {
        return "Password is required";
    }

    // Check password length
    if (password.length < 8) {
        return "Password must be at least 8 characters long";
    }

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
        return "Password must contain at least one uppercase letter";
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
        return "Password must contain at least one lowercase letter";
    }

    // Check for number
    if (!/\d/.test(password)) {
        return "Password must contain at least one number";
    }

    // Check for special character
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return "Password must contain at least one special character";
    }

    return null;
};

const usernameValidator = (username) => {
    if (typeof username !== "string") {
        return "Username must be a string";
    }

    if (username.length < 3 || username.length > 30) {
        return "Username must be between 3 and 30 characters";
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return "Username can only contain letters, numbers, and underscores";
    }

    return null;
};

const emailValidator = (email) => {
    if (typeof email !== "string" || email.length === 0) {
        return "A valid email address is required";
    }
    return null;
};

const codeValidator = (value, fieldLabel, options = {}) => {
    const {
        minLength = 1,
        maxLength = 60,
        pattern = /^[a-zA-Z0-9_-]+$/,
    } = options;

    if (typeof value !== "string" || value.length === 0) {
        return `${fieldLabel} is required and must be a string`;
    }
    if (value.length < minLength || value.length > maxLength) {
        return `${fieldLabel} must be between ${minLength} and ${maxLength} characters`;
    }
    if (!pattern.test(value)) {
        return `${fieldLabel} contains invalid characters`;
    }
    return null;
};

const productCodeValidator = (value, fieldLabel = "Product code") => {
    if (typeof value !== "string" || value.length === 0) {
        return `${fieldLabel} is required and must be a string`;
    }

    if (value.length < 1 || value.length > 20) {
        return `${fieldLabel} must be between 1 and 20 characters`;
    }

    if (!/^\d+$/.test(value)) {
        return `${fieldLabel} must contain only numbers`;
    }

    return null;
};

const categoryNameValidator = (categoryName) =>
    codeValidator(categoryName, "Category name", {
        maxLength: 50,
        pattern: /^[a-zA-Z0-9 _-]+$/,
    });

const mongoIdValidator = (value, fieldLabel) => {
    if (typeof value !== "string") {
        return `${fieldLabel} must be a string`;
    }
    if (!mongoose.Types.ObjectId.isValid(value)) {
        return `${fieldLabel} is not a valid ID`;
    }
    return null;
};

const productIdentifierValidator = (value) => {
    if (typeof value !== "string" || value.length === 0) {
        return "Product identifier is required and must be a string";
    }
    const isValidObjectId = mongoose.Types.ObjectId.isValid(value);
    const isValidCode = /^[a-zA-Z0-9_-]{1,60}$/.test(value);
    if (!isValidObjectId && !isValidCode) {
        return "Product identifier is not valid";
    }
    return null;
};

export {
    passwordValidator,
    usernameValidator,
    emailValidator,
    codeValidator,
    categoryNameValidator,
    mongoIdValidator,
    productIdentifierValidator,
    productCodeValidator,
};