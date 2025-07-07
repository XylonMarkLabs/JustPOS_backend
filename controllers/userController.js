import jwt from 'jsonwebtoken';
import bycrypt from 'bcrypt';
import validator from 'validator';
import userModel from '../models/userModel.js';

// login user
const loginUser = async (req,res) => {
    const { username, password } = req.body;
    try {
        const user = await userModel.findOne({ username });

        if (!user.status) {
            res.json({success: false, message: "User is deactivated"});
            return;
        }

        if (!user) {
            res.json({success: false, message: "Invalid username or password"});
        }
        
        const isMatch = await bycrypt.compare(password, user.password);
        if (!isMatch) {
            return res.json({success: false, message: "Invalid username or password"})
        }

        const token = createToken(user._id);
        const date = new Date();
        const localTime = date.toLocaleString();
        user.lastLogin = localTime;
        await user.save();

        res.json({success: true, token: token});

    } catch (error) {
        console.error(error);
        res.json({success: false, message: "Error"});
    }
}

const createToken = (id) => {
    return jwt.sign({id}, process.env.JWT_SECRET)
}

// register user
const registerUser = async (req,res) => {
    const {firstname, lastname, username, email, role, password} = req.body;
    try {
        // checking is user already exists
        const exists = await userModel.findOne({email});
        if (exists) {
            return res.json({success:false, message: "User already exists"})
        }

        //validating email format and strong password
        if (!validator.isEmail(email)) {
            return res.json({success:false, message: "Please enter a valid email address"})
        }

        if (password.length < 8 ) {
            return res.json({success: false, message: "Please enter a strong password"})
        }

        // hashing user password
        const salt = await bycrypt.genSalt(10);
        const hashedPassword = await bycrypt.hash(password,salt);

        const newUser = new userModel({
            firstname: firstname,
            lastname: lastname,
            username: username,
            email: email,
            role: role,
            password: hashedPassword,
        })

        const user = await newUser.save();
        const token = createToken(user._id)
        res.json({success: true, token});

    } catch (error) {
        console.error(error)
        res.json({success: false, message: "Error"})
    }
}

// update user account status
const updateUserStatus = async (req, res) => {
    const { username, status } = req.body;
    try {
        const user = await userModel.findOne({ username });

        if (!user) {
            res.json({success: false, message: "Invalid username"});
        }

        await userModel.findOneAndUpdate({ username }, {status: status} );

        res.json({success: true, message: "User status updated successfully"});

    } catch (error) {
        console.log("Error updating user status: ", error);
        res.json({success: false, message: "Error updating user status"});
    }
}

// edit user details
const editUser = async (req,res) => {
    try {
        const { username } = req.body;

        const user = await userModel.findOne({ username });

        if (!user) {
            res.json({success: false, message: "Invalid username"});
        }

        await userModel.findOneAndUpdate({username: username}, {firstname: req.body.name, lastname: req.body.lastname, email: req.body.email, role: req.body.role})
        res.json({ success: true, message: "User updated"})
    } catch (error) {
        console.error(error);
        res.json({ success: false, message: "Error"});
    }
}

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


export { loginUser, registerUser, updateUserStatus, editUser, deleteUser };