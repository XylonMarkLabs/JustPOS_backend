const passwordValidator = (password) => {

    // Check if password is provided
    if (!password) {
        return res.status(400).json({ success: false, message: "Password is required" });
    }

    // Check password length
    if (password.length < 8) {
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters long" });
    }

    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ success: false, message: "Password must contain at least one uppercase letter" });
    }

    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
        return res.status(400).json({ success: false, message: "Password must contain at least one lowercase letter" });
    }

    // Check for number
    if (!/\d/.test(password)) {
        return res.status(400).json({ success: false, message: "Password must contain at least one number" });
    }

    // Check for special character
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        return res.status(400).json({ success: false, message: "Password must contain at least one special character" });
    }

    return null;
}

export { passwordValidator };