const connection = require('../config/database');

const cartController = {
    addToCart: (req, res) => {
        const productId = parseInt(req.params.id);
        const quantity = parseInt(req.body.quantity) || 1;

        connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
            if (error) {
                console.error(error);
                return res.status(500).send('Error adding to cart');
            }

            if (results.length > 0) {
                const product = results[0];

                if (!req.session.cart) {
                    req.session.cart = [];
                }

                const existingItem = req.session.cart.find(item => item.id === productId);
                
                if (existingItem) {
                    existingItem.quantity += quantity;
                } else {
                    req.session.cart.push({
                        id: product.id,
                        name: product.productName,
                        price: parseFloat(product.price),
                        quantity: quantity,
                        image: product.image
                    });
                }

                req.flash('success', 'Product added to cart!');
                res.redirect('/cart');
            } else {
                res.status(404).send('Product not found');
            }
        });
    },

    viewCart: (req, res) => {
        const cart = req.session.cart || [];
        const user = req.session.user;
        
        let total = 0;
        cart.forEach(item => {
            total += item.price * item.quantity;
        });

        res.render('cart', { 
            cart, 
            user, 
            total,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    },

    removeFromCart: (req, res) => {
        const productId = parseInt(req.params.id);

        if (req.session.cart) {
            req.session.cart = req.session.cart.filter(item => item.id !== productId);
        }

        req.flash('success', 'Item removed from cart');
        res.redirect('/cart');
    },

    updateQuantity: (req, res) => {
        const productId = parseInt(req.params.id);
        const newQuantity = parseInt(req.body.quantity);

        if (req.session.cart && newQuantity > 0) {
            const item = req.session.cart.find(item => item.id === productId);
            if (item) {
                item.quantity = newQuantity;
            }
        }

        res.redirect('/cart');
    },

    clearCart: (req, res) => {
        req.session.cart = [];
        req.flash('success', 'Cart cleared');
        res.redirect('/cart');
    }
};

module.exports = cartController;
