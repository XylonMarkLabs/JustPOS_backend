import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import mongooseSequence from 'mongoose-sequence';

const AutoIncrement = mongooseSequence(mongoose);

const businessSchema = new mongoose.Schema({
    businessId: {
        type: Number,
        unique: true,
        trim: true
    },
    name: {
        type: String,
        required: [true, 'Business name is required'],
        trim: true
    },
    hashedPassword: {
        type: String,
        required: [true, 'Password is required']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        trim: true,
        lowercase: true
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true
    },
    address: {
        street: String,
        city: String,
        state: String,
        country: String,
        postalCode: String
    },
    status: {
        type: String,
        default: 'active',
        enum: ['active', 'inactive', 'suspended']
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Pre-save middleware to hash password
businessSchema.pre('save', async function (next) {
    if (!this.isModified('hashedPassword')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.hashedPassword = await bcrypt.hash(this.hashedPassword, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare password
businessSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.hashedPassword);
};

businessSchema.plugin(AutoIncrement, { inc_field: 'businessId' });

const businessModel = mongoose.models.business || mongoose.model('business', businessSchema);

export default businessModel;
