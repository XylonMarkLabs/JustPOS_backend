import bycrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';
import {
    emailValidator,
    passwordValidator,
    usernameValidator,
    mongoIdValidator,
} from '../middleware/inputValidator.js';
import { logger, maskEmail } from '../utils/logger.js';

const isNil = (v) => v === undefined || v === null || v === '';

// The acting user comes from requireAuth (server-side), never from the request body.
const actorOf = (req) => String(req.user._id);

// Logs a rejected user operation (expected failure, so "warn") and sends the
// same response the controller always sent. `detail` is the validator's own
// static message, never user input.
const reject = (res, event, reason, message, extra = {}) => {
    logger.warn({ event, reason, detail: message, ...extra }, 'User operation rejected');
    return res.json({ success: false, message });
};

// Display name: plain string, 1-100 characters.
const nameValidator = (name) => {
    if (typeof name !== "string" || name.trim().length === 0) {
        return "Name is required and must be a string";
    }
    if (name.length > 100) {
        return "Name must be at most 100 characters";
    }
    return null;
};

// Email: shared emailValidator (type check) + validator.isEmail (format check).
// The type check MUST run first, because validator.isEmail throws on non-strings.
const fullEmailValidator = (email) => {
    const typeError = emailValidator(email);
    if (typeError) return typeError;
    if (!validator.isEmail(email)) {
        return "Please enter a valid email address";
    }
    return null;
};

const roleValidator = (role) => {
    const allowedRoles = ["Admin", "Cashier", "Manager"];
    if (typeof role !== "string" || role.trim().length === 0) {
        return "Role is required and must be a string";
    }
    if (!allowedRoles.includes(role)) {
        return "Invalid role";
    }
    return null;
};

const userStatusValidator = (status) => {
    const allowed = [0, 1];
    if (!allowed.includes(status)) {
        return "Status is not valid";
    }
    return null;
};

// Passwords being compared/hashed by bcrypt must be non-empty strings
// (bcrypt throws on anything else). Used for the *old* password, which
// shouldn't be re-checked against today's strength rules.
const passwordPresenceValidator = (password, label) => {
    if (typeof password !== "string" || password.length === 0) {
        return `${label} is required`;
    }
    return null;
};

const registerUser = async (req, res) => {
    const { name, username, email, role, password } = req.body;
    const actorUserId = actorOf(req);
    const fail = (reason, message, extra = {}) =>
        reject(res, 'USER_REGISTRATION_FAILED', reason, message, { actorUserId, ...extra });

    try {
        // --- validate every input first, before any DB query ---
        const nameError = nameValidator(name);
        if (nameError) {
            return fail('VALIDATION_FAILED', nameError);
        }

        const emailError = fullEmailValidator(email);
        if (emailError) {
            return fail('VALIDATION_FAILED', emailError);
        }

        const usernameValidationError = usernameValidator(username);
        if (usernameValidationError) {
            return fail('VALIDATION_FAILED', usernameValidationError);
        }

        const roleError = roleValidator(role);
        if (roleError) {
            return fail('VALIDATION_FAILED', roleError);
        }

        const validationError = passwordValidator(password);
        if (validationError) {
            return fail('VALIDATION_FAILED', validationError);
        }

        // checking is user already exists
        const exists = await userModel.findOne({ email });
        if (exists) {
            return fail('EMAIL_EXISTS', "User already exists", { emailMasked: maskEmail(email) });
        }

        const usernameExists = await userModel.findOne({ username });
        if (usernameExists) {
            return fail('USERNAME_EXISTS', "Username already exists", { username });
        }

        // hashing user password
        const salt = await bycrypt.genSalt(10);
        const hashedPassword = await bycrypt.hash(password, salt);

        const newUser = new userModel({
            name: name,
            username: username,
            email: email,
            role: role,
            password: hashedPassword,
        })

        await newUser.save();

        logger.info(
            {
                event: 'USER_REGISTERED',
                actorUserId,
                targetUserId: String(newUser._id),
                username,
                role,
                emailMasked: maskEmail(email),
            },
            'User account created'
        );

        res.json({ success: true, message: "User created successfully" });

    } catch (error) {
        if (error?.code === 11000) {
            // two requests raced past the exists-checks and hit the unique index
            logger.warn({ event: 'USER_REGISTRATION_FAILED', reason: 'DUPLICATE_KEY', actorUserId }, 'Duplicate user on save');
        } else {
            logger.error({ event: 'USER_REGISTRATION_ERROR', actorUserId, err: error }, 'Unexpected error creating user');
        }
        res.json({ success: false, message: "Error" })
    }
}

// update user account status
const updateUserStatus = async (req, res) => {
    const { username, status } = req.body;
    const actorUserId = actorOf(req);
    const fail = (reason, message, extra = {}) =>
        reject(res, 'USER_STATUS_CHANGE_FAILED', reason, message, { actorUserId, ...extra });

    try {
        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return fail('VALIDATION_FAILED', usernameValidationError);
        }

        const statusError = userStatusValidator(status);
        if (statusError) {
            return fail('VALIDATION_FAILED', statusError);
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return fail('USER_NOT_FOUND', "Invalid username", { username });
        }

        const previousStatus = user.status;

        await userModel.findOneAndUpdate({ username }, { status: status });

        logger.info(
            {
                event: status === 1 ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
                actorUserId,
                targetUserId: String(user._id),
                previousStatus,
                newStatus: status,
                selfAction: String(user._id) === actorUserId,
            },
            status === 1 ? 'User account reactivated' : 'User account deactivated'
        );

        res.json({ success: true, message: "User status updated successfully" });

    } catch (error) {
        logger.error({ event: 'USER_STATUS_CHANGE_ERROR', actorUserId, err: error }, 'Unexpected error updating user status');
        res.json({ success: false, message: "Error updating user status" });
    }
}

// edit user details
const editUser = async (req, res) => {
    const actorUserId = actorOf(req);
    const fail = (reason, message, extra = {}) =>
        reject(res, 'USER_UPDATE_FAILED', reason, message, { actorUserId, ...extra });

    try {
        const { username, name, email, role, password } = req.body;

        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return fail('VALIDATION_FAILED', usernameValidationError);
        }

        // name / email / role are optional here, but if sent they must be valid
        if (!isNil(name)) {
            const nameError = nameValidator(name);
            if (nameError) return fail('VALIDATION_FAILED', nameError);
        }

        if (!isNil(email)) {
            const emailError = fullEmailValidator(email);
            if (emailError) return fail('VALIDATION_FAILED', emailError);
        }

        if (!isNil(role)) {
            const roleError = roleValidator(role);
            if (roleError) return fail('VALIDATION_FAILED', roleError);
        }

        // password is optional; "" / missing means "leave unchanged"
        if (!isNil(password)) {
            const validationError = passwordValidator(password);
            if (validationError) {
                return fail('VALIDATION_FAILED', validationError);
            }
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return fail('USER_NOT_FOUND', "Invalid username", { username });
        }

        // only update the fields that were actually sent
        const updateFields = {};
        if (!isNil(name)) updateFields.name = name;
        if (!isNil(email)) updateFields.email = email;
        if (!isNil(role)) updateFields.role = role;

        if (!isNil(password)) {
            const salt = await bycrypt.genSalt(10);
            const hashedPassword = await bycrypt.hash(password, salt);
            updateFields.password = hashedPassword;
        }

        // Field NAMES that really change (never values). Password always counts when sent.
        const previousRole = user.role;
        const changedFields = Object.keys(updateFields).filter(
            (key) => key === 'password' || updateFields[key] !== user[key]
        );

        await userModel.findOneAndUpdate({ username }, updateFields);

        const targetUserId = String(user._id);

        logger.info(
            { event: 'USER_UPDATED', actorUserId, targetUserId, changedFields, passwordChanged: changedFields.includes('password') },
            'User details updated'
        );

        // Role changes are security-relevant, so they also get their own searchable event.
        if (changedFields.includes('role')) {
            logger.info(
                { event: 'USER_ROLE_CHANGED', actorUserId, targetUserId, previousRole, newRole: role, selfAction: targetUserId === actorUserId },
                'User role changed'
            );
        }

        res.json({
            success: true,
            message: !isNil(password)
                ? "User updated with new password"
                : "User updated successfully",
        });

    } catch (error) {
        if (error?.code === 11000) {
            logger.warn({ event: 'USER_UPDATE_FAILED', reason: 'DUPLICATE_KEY', actorUserId }, 'Duplicate email or username on update');
        } else {
            logger.error({ event: 'USER_UPDATE_ERROR', actorUserId, err: error }, 'Unexpected error updating user');
        }
        res.status(500).json({ success: false, message: "Error updating user" });
    }
};


// delete user account
const deleteUser = async (req, res) => {
    const actorUserId = actorOf(req);
    const fail = (reason, message, extra = {}) =>
        reject(res, 'USER_DELETE_FAILED', reason, message, { actorUserId, ...extra });

    try {
        const { username } = req.body;

        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return fail('VALIDATION_FAILED', usernameValidationError);
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return fail('USER_NOT_FOUND', "Invalid username", { username });
        }

        // Delete the user
        await userModel.findOneAndDelete({ username });

        logger.info(
            {
                event: 'USER_DELETED',
                actorUserId,
                targetUserId: String(user._id),
                targetUsername: user.username,
                targetRole: user.role,
                selfAction: String(user._id) === actorUserId,
            },
            'User account deleted'
        );

        res.json({ success: true, message: "User deleted" });
    } catch (error) {
        logger.error({ event: 'USER_DELETE_ERROR', actorUserId, err: error }, 'Unexpected error deleting user');
        res.json({ success: false, message: "Error deleting user" });
    }
}

const changePassword = async (req, res) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const username = req.user.username;
    const userId = actorOf(req);
    const fail = (reason, message) =>
        reject(res, 'PASSWORD_CHANGE_FAILED', reason, message, { targetUserId: userId });

    try {
        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return fail('INVALID_INPUT', usernameValidationError);
        }

        // all three must be strings before they reach bcrypt / comparisons
        const oldPasswordError = passwordPresenceValidator(oldPassword, "Old password");
        if (oldPasswordError) {
            return fail('INVALID_INPUT', oldPasswordError);
        }

        const confirmError = passwordPresenceValidator(confirmPassword, "Password confirmation");
        if (confirmError) {
            return fail('INVALID_INPUT', confirmError);
        }

        const validationError = passwordValidator(newPassword);
        if (validationError) {
            return fail('INVALID_INPUT', validationError);
        }

        if (newPassword !== confirmPassword) {
            return fail('PASSWORD_MISMATCH', "New passwords do not match");
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return fail('USER_NOT_FOUND', "Invalid username");
        }

        const isMatch = await bycrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            // Repeated failures here can indicate a hijacked session guessing the password.
            return fail('WRONG_OLD_PASSWORD', "Invalid password");
        }

        // Update the password
        const salt = await bycrypt.genSalt(10);
        const hashedPassword = await bycrypt.hash(newPassword, salt);
        user.password = hashedPassword;
        await user.save();

        logger.info({ event: 'PASSWORD_CHANGED', targetUserId: userId }, 'User changed their password');

        res.json({ success: true, message: "Password changed successfully" });

    } catch (error) {
        logger.error({ event: 'PASSWORD_CHANGE_ERROR', targetUserId: userId, err: error }, 'Unexpected error changing password');
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
}

const fetchUsers = async (req, res) => {
    try {
        const users = await userModel.find({}).select('-password');
        res.json({ success: true, users: users });
    } catch (error) {
        logger.error({ event: 'USER_QUERY_ERROR', operation: 'fetchUsers', err: error }, 'Error fetching users');
        res.json({ success: false, message: "Error fetching users" });
    }
}

// Same password-exclusion fix as fetchUsers.
const getUserById = async (req, res) => {
    const { id } = req.body;
    try {
        const idError = mongoIdValidator(id, "User ID");
        if (idError) {
            return reject(res, 'USER_LOOKUP_FAILED', 'INVALID_ID', idError, { actorUserId: actorOf(req) });
        }

        const user = await userModel.findById(id).select('-password');
        if (!user) {
            return reject(res, 'USER_LOOKUP_FAILED', 'USER_NOT_FOUND', "User not found", { actorUserId: actorOf(req) });
        }
        res.json({ success: true, user: user });
    } catch (error) {
        logger.error({ event: 'USER_QUERY_ERROR', operation: 'getUserById', err: error }, 'Error fetching user by ID');
        res.json({ success: false, message: "Error fetching user" });
    }
}

export { registerUser, updateUserStatus, editUser, deleteUser, changePassword, fetchUsers, getUserById };