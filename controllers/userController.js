import bycrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';
import { passwordValidator } from '../middleware/passwordValidator.js';

// register user (admin creating a new staff account — NOT a self-signup
// flow, so this no longer returns a login token. The previous
// createToken(user._id) call was also missing its second argument,
// silently producing a token with username: undefined that nothing
// actually used anyway.)
const registerUser = async (req, res) => {
    const { name, username, email, role, password } = req.body;
    try {
        // checking is user already exists
        const exists = await userModel.findOne({ email });
        if (exists) {
            return res.json({ success: false, message: "User already exists" })
        }

        //validating email format and strong password
        if (!validator.isEmail(email)) {
            return res.json({ success: false, message: "Please enter a valid email address" })
        }

        const validationError = passwordValidator(password);
        if (validationError) {
            return res.json({ success: false, message: validationError });
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

        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        const updateFields = {
            name,
            email,
            role,
        };

        if (password) {
            const validationError = passwordValidator(password);
            if (validationError) {
                return res.json({ success: false, message: validationError });
            }

            const salt = await bycrypt.genSalt(10);
            const hashedPassword = await bycrypt.hash(password, salt);
            updateFields.password = hashedPassword;
        }

        await userModel.findOneAndUpdate({ username }, updateFields);

        res.json({
            success: true,
            message: password
                ? "User updated with new password"
                : "User updated successfully",
        });

    } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};


// delete user account
const deleteUser = async (req, res) => {
    try {
        const { username } = req.body;

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

// Changed to identify the caller from their own session (req.user, set by
// requireAuth on the route) rather than a client-supplied `username` in
// the body — otherwise nothing stopped a request claiming to be any
// other account and changing THEIR password.
const changePassword = async (req, res) => {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    const username = req.user.username;

    try {
        const user = await userModel.findOne({ username });

        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        const isMatch = await bycrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: "Invalid password" });
        }

        if (newPassword !== confirmPassword) {
            return res.json({ success: false, message: "New passwords do not match" });
        }

        const validationError = passwordValidator(newPassword);
        if (validationError) {
            return res.json({ success: false, message: validationError });
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

// Excludes password hashes from the response — previously returned the
// full user documents, hash included, to anyone who could reach this
// endpoint (which, until requireAuth is applied at the router level, was
// anyone at all).
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