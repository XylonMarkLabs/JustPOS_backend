import supplierModel from "../models/supplierModal.js";

const addSupplier = async (req, res) => {
    try {
        const {
            supplierId,
            supplierName,
            contactPerson,
            contactNo,
            email
        } = req.body;

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

        const supplier = await supplierModel.findOneAndUpdate({ supplierId }, {
            supplierName,
            contactPerson,
            contactNo,
            email
        });

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

        const supplier = await supplierModel.findOneAndUpdate({ supplierId }, { status: status });

        if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
        }

        res.status(200).json({ success: true, message: 'Supplier status updated successfully' });

    } catch (error) {
        console.log(error);
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