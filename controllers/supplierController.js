import validator from "validator";
import supplierModel from "../models/supplierModal.js";
import { codeValidator, emailValidator } from "../middleware/inputValidator.js";

const badRequest = (res, message) =>
    res.status(400).json({ success: false, message });

// Return the first non-null error message (or null).
const firstError = (...errors) => errors.find(Boolean) || null;

const supplierIdValidator = (supplierId) =>
    codeValidator(supplierId, 'Supplier ID');

const supplierNameValidator = (name) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
        return 'Supplier name is required and must be a string';
    }
    if (name.length > 100) {
        return 'Supplier name must be at most 100 characters';
    }
    return null;
};

const contactPersonValidator = (name) => {
    if (typeof name !== 'string') {
        return 'Contact person must be a string';
    }
    if (name.length > 100) {
        return 'Contact person must be at most 100 characters';
    }
    return null;
};

const contactNoValidator = (contactNo) =>
    codeValidator(contactNo, 'Contact number', {
        minLength: 7,
        maxLength: 20,
        pattern: /^[0-9+\-()\s]+$/,
    });

const supplierEmailValidator = (email) => {
    const typeError = emailValidator(email);
    if (typeError) return typeError;
    if (!validator.isEmail(email)) {
        return 'Please enter a valid email address';
    }
    return null;
};

const supplierStatusValidator = (status) => {
    const allowed = [0, 1];
    if (!allowed.includes(status)) {
        return 'Status is not valid';
    }
    return null;
};

// For optional fields: not sent (undefined) or an empty string is skipped;
// anything else (including null, objects, arrays) must pass the validator.
const optional = (value, validatorFn) =>
    value === undefined || value === '' ? null : validatorFn(value);

const addSupplier = async (req, res) => {
    try {
        const {
            supplierId,
            supplierName,
            contactPerson,
            contactNo,
            email
        } = req.body;

        const inputError = firstError(
            supplierIdValidator(supplierId),
            supplierNameValidator(supplierName),
            optional(contactPerson, contactPersonValidator),
            optional(contactNo, contactNoValidator),
            optional(email, supplierEmailValidator),
        );
        if (inputError) return badRequest(res, inputError);

        // Check for existing supplierId
        const existingSupplier = await supplierModel.findOne({ supplierId });
        if (existingSupplier) {
            return res.status(400).json({ success: false, message: 'Supplier ID already exists' });
        }

        const newSupplier = new supplierModel({
            supplierId,
            supplierName,
            contactPerson,
            contactNo,
            email
        });

        await newSupplier.save();

        res.status(201).json({ success: true, message: 'Supplier added successfully', supplier: newSupplier });

    } catch (error) {
        console.error('Error adding supplier:', error);
        res.status(500).json({ success: false, message: 'Server error while adding supplier' });
    }
};

const editSupplier = async (req, res) => {
    try {
        const {
            supplierId,
            supplierName,
            contactPerson,
            contactNo,
            email
        } = req.body;

        // supplierId identifies the record, so it is required; the rest are
        // checked only if sent ("" is allowed for the optional contact fields
        // so they can be cleared).
        const inputError = firstError(
            supplierIdValidator(supplierId),
            supplierName !== undefined ? supplierNameValidator(supplierName) : null,
            optional(contactPerson, contactPersonValidator),
            optional(contactNo, contactNoValidator),
            optional(email, supplierEmailValidator),
        );
        if (inputError) return badRequest(res, inputError);

        // only update the fields that were actually sent
        const updateFields = {};
        if (supplierName !== undefined) updateFields.supplierName = supplierName;
        if (contactPerson !== undefined) updateFields.contactPerson = contactPerson;
        if (contactNo !== undefined) updateFields.contactNo = contactNo;
        if (email !== undefined) updateFields.email = email;

        const supplier = await supplierModel.findOneAndUpdate({ supplierId }, updateFields);

        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        res.status(201).json({ success: true, message: 'Supplier edited successfully' });

    } catch (error) {
        console.error('Error editing supplier:', error);
        res.status(500).json({ success: false, message: 'Server error while editing supplier' });
    }
};

const updateSupplierStatus = async (req, res) => {
    try {
        const { supplierId, status } = req.body;

        const inputError = firstError(
            supplierIdValidator(supplierId),
            supplierStatusValidator(status),
        );
        if (inputError) return badRequest(res, inputError);

        const supplier = await supplierModel.findOneAndUpdate({ supplierId }, { status: status });

        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        res.status(200).json({ success: true, message: 'Supplier status updated successfully' });

    } catch (error) {
        console.error('Error updating supplier status:', error);
        res.status(500).json({ success: false, message: 'Server error while updating supplier status' });
    }
};

const getSuppliers = async (req, res) => {
    try {
        const suppliers = await supplierModel.find({});
        res.status(200).json({ success: true, suppliers });
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching suppliers' });
    }
};

// const deleteSupplier = async (req, res) => {
//     try {
//         const { supplierId } = req.body;

//         // Find the supplier first
//         const supplier = await supplierModel.findOne({ supplierId });

//         if (!supplier) {
//             return res.status(404).json({ success: false, message: 'Supplier not found' });
//         }

//         // Delete the supplier from DB
//         await supplierModel.findOneAndDelete({ supplierId });

//         res.status(200).json({ success: true, message: 'Supplier deleted successfully' });

//     } catch (error) {
//         console.error('Error deleting supplier:', error);
//         res.status(500).json({ success: false, message: 'Server error while deleting supplier' });
//     }
// };

export { addSupplier, editSupplier, updateSupplierStatus, getSuppliers };