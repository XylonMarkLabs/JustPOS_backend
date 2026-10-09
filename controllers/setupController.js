import bcrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';
import businessModel from '../models/businessModel.js';
import { passwordValidator, usernameValidator } from '../middleware/inputValidator.js';

const SETUP_ALREADY_COMPLETE = 'SETUP_ALREADY_COMPLETE';

const SETUP_FIELDS = ['businessName', 'adminName', 'email', 'username', 'password'];

const checkUserExists = async (req, res) => {
    try {
        const hasAdmin = await userModel.exists({ role: 'Admin' });

        return res.json({
            success: true,
            setupRequired: !hasAdmin,
            message: hasAdmin
                ? 'Admin user exists. Setup is complete.'
                : 'No admin user found. Setup is required.',
        });
    } catch (error) {
        console.error('Error checking setup status:', error);
        return res.status(500).json({ success: false, message: 'Unable to check setup status' });
    }
};

const validateSetupInput = ({ businessName, adminName, email, username, password }) => {
    if (!businessName) return 'Business name is required';
    if (businessName.length > 100) return 'Business name must be 100 characters or fewer';

    if (!adminName) return 'Administrator name is required';
    if (adminName.length > 100) return 'Administrator name must be 100 characters or fewer';

    if (!email) return 'Email address is required';
    if (!validator.isEmail(email)) return 'Please enter a valid email address';

    if (!username) return 'Username is required';
    const usernameError = usernameValidator(username);
    if (usernameError) return usernameError;

    if (!password) return 'Password is required';
    return passwordValidator(password) || null;
};

const registerFirstUser = async (req, res) => {
    try {
        // 1. Setup is only allowed while no admin exists. Checked first so a
        //    completed system reveals nothing else about itself.
        const adminExists = await userModel.exists({ role: 'Admin' });
        if (adminExists) {
            return res.status(409).json({
                success: false,
                code: SETUP_ALREADY_COMPLETE,
                message: 'Setup has already been completed.',
            });
        }

        // 2. Only accept plain strings (rejects objects such as { $ne: null },
        //    which would otherwise turn the lookups below into operator queries).
        const body = req.body || {};
        if (SETUP_FIELDS.some((field) => typeof body[field] !== 'string')) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const input = {
            businessName: body.businessName.trim(),
            adminName: body.adminName.trim(),
            email: body.email.trim().toLowerCase(),
            username: body.username.trim(),
            password: body.password,
        };

        // 3. Never trust the client's validation.
        const validationError = validateSetupInput(input);
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        // 4. There can be existing non-admin users (setup is "required" whenever
        //    no admin exists), so make sure the email/username aren't taken.
        //    Deliberately 400, not 409: the frontend treats 409 as "setup done".
        const duplicate = await userModel.findOne({
            $or: [{ email: input.email }, { username: input.username }],
        });
        if (duplicate) {
            return res.status(400).json({
                success: false,
                message: 'A user with this email or username already exists',
            });
        }

        // 5. Business profile — one business per database. Reuse the existing
        //    document if a previous attempt (or provisioning) already made one,
        //    so a retry after a failure never creates duplicates.
        const existingBusiness = await businessModel.findOne({});
        if (existingBusiness) {
            existingBusiness.businessName = input.businessName;
            existingBusiness.updatedAt = new Date();
            await existingBusiness.save();
        } else {
            await businessModel.create({ businessName: input.businessName });
        }

        // 6. Create the administrator. The role is fixed here and is never read
        //    from the request body.
        const hashedPassword = await bcrypt.hash(input.password, 10);

        await userModel.create({
            name: input.adminName,
            username: input.username,
            email: input.email,
            role: 'Admin',
            password: hashedPassword,
        });

        return res.status(201).json({
            success: true,
            message: 'Administrator account created successfully',
        });
    } catch (error) {
        console.error('Error during initial setup:', error);

        // Unique-index collision (e.g. two requests racing on the same username).
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A user with this email or username already exists',
            });
        }

        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: error.message });
        }

        return res.status(500).json({
            success: false,
            message: 'Something went wrong during setup. Please try again.',
        });
    }
};

export { checkUserExists, registerFirstUser };