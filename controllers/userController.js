import bycrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';
import {
    emailValidator,
    passwordValidator,
    usernameValidator,
    mongoIdValidator,
} from '../middleware/inputValidator.js';

const isNil = (v) => v === undefined || v === null || v === '';

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
    try {
        // --- validate every input first, before any DB query ---
        const nameError = nameValidator(name);
        if (nameError) {
            return res.json({ success: false, message: nameError });
        }

        const emailError = fullEmailValidator(email);
        if (emailError) {
            return res.json({ success: false, message: emailError });
        }

        const usernameValidationError = usernameValidator(username);
        if (usernameValidationError) {
            return res.json({ success: false, message: usernameValidationError });
        }

        const roleError = roleValidator(role);
        if (roleError) {
            return res.json({ success: false, message: roleError });
        }

        const validationError = passwordValidator(password);
        if (validationError) {
            return res.json({ success: false, message: validationError });
        }

        // checking is user already exists
        const exists = await userModel.findOne({ email });
        if (exists) {
            return res.json({ success: false, message: "User already exists" })
        }

        const usernameExists = await userModel.findOne({ username });
        if (usernameExists) {
            return res.json({ success: false, message: "Username already exists" });
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
        res.json({ success: true, message: "User created successfully" });

    } catch (error) {
        console.error(error)
        res.json({ success: false, message: "Error" })
    }
}

// update user account status
const updateUserStatus = async (req, res) => {
    const { username, status } = req.body;
    try {
        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return res.json({ success: false, message: usernameValidationError });
        }

        const statusError = userStatusValidator(status);
        if (statusError) {
            return res.json({ success: false, message: statusError });
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        await userModel.findOneAndUpdate({ username }, { status: status });

        res.json({ success: true, message: "User status updated successfully" });

    } catch (error) {
        console.log("Error updating user status: ", error);
        res.json({ success: false, message: "Error updating user status" });
    }
}

// edit user details
const editUser = async (req, res) => {
    try {
        const { username, name, email, role, password } = req.body;

        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return res.json({ success: false, message: usernameValidationError });
        }

        // name / email / role are optional here, but if sent they must be valid
        if (!isNil(name)) {
            const nameError = nameValidator(name);
            if (nameError) return res.json({ success: false, message: nameError });
        }

        if (!isNil(email)) {
            const emailError = fullEmailValidator(email);
            if (emailError) return res.json({ success: false, message: emailError });
        }

        if (!isNil(role)) {
            const roleError = roleValidator(role);
            if (roleError) return res.json({ success: false, message: roleError });
        }

        // password is optional; "" / missing means "leave unchanged"
        if (!isNil(password)) {
            const validationError = passwordValidator(password);
            if (validationError) {
                return res.json({ success: false, message: validationError });
            }
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
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

        await userModel.findOneAndUpdate({ username }, updateFields);

        res.json({
            success: true,
            message: !isNil(password)
                ? "User updated with new password"
                : "User updated successfully",
        });

    } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ success: false, message: "Error updating user" });
    }
};


// delete user account
const deleteUser = async (req, res) => {
    try {
        const { username } = req.body;

        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return res.json({ success: false, message: usernameValidationError });
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        // Delete the user
        await userModel.findOneAndDelete({ username });

        res.json({ success: true, message: "User deleted" });
    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Error deleting user" });
    }
}

const changePassword = async (req, res) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const username = req.user.username;

    try {
        const usernameValidationError = usernameValidator(username);

        if (usernameValidationError) {
            return res.json({ success: false, message: usernameValidationError });
        }

        // all three must be strings before they reach bcrypt / comparisons
        const oldPasswordError = passwordPresenceValidator(oldPassword, "Old password");
        if (oldPasswordError) {
            return res.json({ success: false, message: oldPasswordError });
        }

        const confirmError = passwordPresenceValidator(confirmPassword, "Password confirmation");
        if (confirmError) {
            return res.json({ success: false, message: confirmError });
        }

        const validationError = passwordValidator(newPassword);
        if (validationError) {
            return res.json({ success: false, message: validationError });
        }

        if (newPassword !== confirmPassword) {
            return res.json({ success: false, message: "New passwords do not match" });
        }

        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        const isMatch = await bycrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: "Invalid password" });
        }

        // Update the password
        const salt = await bycrypt.genSalt(10);
        const hashedPassword = await bycrypt.hash(newPassword, salt);
        user.password = hashedPassword;
        await user.save();

        res.json({ success: true, message: "Password changed successfully" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Something went wrong" });
    }
}

const fetchUsers = async (req, res) => {
    try {
        const users = await userModel.find({}).select('-password');
        res.json({ success: true, users: users });
    } catch (error) {
        console.log("Error fetching users: ", error);
        res.json({ success: false, message: "Error fetching users" });
    }
}

// Same password-exclusion fix as fetchUsers.
const getUserById = async (req, res) => {
    const { id } = req.body;
    try {
        const idError = mongoIdValidator(id, "User ID");
        if (idError) {
            return res.json({ success: false, message: idError });
        }

        const user = await userModel.findById(id).select('-password');
        if (!user) {
            return res.json({ success: false, message: "User not found" });
        }
        res.json({ success: true, user: user });
    } catch (error) {
        console.error("Error fetching user by ID: ", error);
        res.json({ success: false, message: "Error fetching user" });
    }
}

export { registerUser, updateUserStatus, editUser, deleteUser, changePassword, fetchUsers, getUserById };