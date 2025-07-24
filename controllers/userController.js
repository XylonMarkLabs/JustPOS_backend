import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';
import { passwordValidator } from '../middleware/passwordValidator.js';

// login user
const loginUser = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await userModel.findOne({ username });

        if (!user.status) {
            res.json({ success: false, message: "User is deactivated" });
            return;
        }

        if (!user) {
            res.json({ success: false, message: "Invalid username or password" });
        }

        const isMatch = await bycrypt.compare(password, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: "Invalid username or password" })
        }

        const token = createToken(user._id, user.username);
        const date = new Date();
        const localTime = date.toLocaleString();
        user.lastLogin = localTime;
        await user.save();

        res.json({ success: true, token: token, username: username });

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Error" });
    }
}

const createToken = (id, username) => {
    return jwt.sign({ id: id, username: username }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

// register user
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

        const user = await newUser.save();
        const token = createToken(user._id)
        res.json({ success: true, token });

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
            res.json({ success: false, message: "Invalid username" });
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

const changePassword = async (req, res) => {
    const { username, oldpassword, newpassword, newpassword2 } = req.body;

    const user = await userModel.findOne({ username });

    try {
        if (!user) {
            return res.json({ success: false, message: "Invalid username" });
        }

        const isMatch = await bycrypt.compare(oldpassword, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: "Invalid password" });
        }

        if (newpassword !== newpassword2) {
            return res.json({ success: false, message: "New passwords do not match" });
        }

        const validationError = passwordValidator(newpassword);
        if (validationError) {
            return res.json({ success: false, message: validationError });
        }

        // Update the password
        const salt = await bycrypt.genSalt(10);
        const hashedPassword = await bycrypt.hash(newpassword, salt);
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
        const users = await userModel.find({});
        res.json({ success: true, users: users });
    } catch (error) {
        console.log("Error fetching users: ", error);
        res.json({ success: false, message: "Error fetching users" });
    }
}

const getUserById = async (req, res) => {
    const { id } = req.body;
    try {
        const user = await userModel.findById(id);
        if (!user) {    
            return res.json({ success: false, message: "User not found" });
        }
        res.json({ success: true, user: user });
    } catch (error) {
        console.error("Error fetching user by ID: ", error);
        res.json({ success: false, message: "Error fetching user" });
    }
}

export { loginUser, registerUser, updateUserStatus, editUser, deleteUser, changePassword, fetchUsers, getUserById };