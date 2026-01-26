const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
require('dotenv').config();
const app = express();
const axios = require('axios');

// Update multer configuration to shorten filenames
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images');
    },
    filename: (req, file, cb) => {
        // Get file extension
        const ext = file.originalname.split('.').pop();
        // Create shorter filename: timestamp + extension
        const shortName = Date.now() + '.' + ext;
        cb(null, shortName);
    }
});

const upload = multer({ storage: storage });

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'  // Changed back
});

connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database');
    
    // ⭐ ADD THIS LINE - Share connection with routes
    app.locals.connection = connection;
});

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));
app.use(express.json());

//TO DO: Insert code for Session Middleware below 
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } 
}));

app.use(flash());

// Add these lines after the flash middleware
const cartRoutes = require('./routes/cartRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const paypal = require('./services/paypal');
const checkoutController = require('./controllers/checkoutController');
const netsQr = require('./services/nets');

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, confirmPassword, address, contact, role } = req.body;

    if (!username || !email || !password || !confirmPassword || !address || !contact || !role) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    
    if (password.length < 8) {
        req.flash('error', 'Password must be at least 8 characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    // Check password complexity
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (!hasUpperCase || !hasLowerCase || !hasNumber || !hasSpecialChar) {
        req.flash('error', 'Password must contain uppercase, lowercase, number, and special character');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    if (password !== confirmPassword) {
        req.flash('error', 'Passwords do not match');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    next();
};

// Mount new routes (add before existing routes)
app.use('/cart', cartRoutes);
app.use('/checkout', checkoutRoutes);

// PayPal API routes
app.post('/api/paypal/create-order', checkAuthenticated, async (req, res) => {
    try {
        const total = req.session.paymentTotal || 0;
        if (!total || total <= 0) {
            return res.status(400).json({ error: 'Invalid payment amount' });
        }

        const order = await paypal.createOrder(total.toFixed(2));
        if (order && order.id) {
            return res.json({ id: order.id });
        }

        return res.status(500).json({ error: 'Failed to create PayPal order', details: order });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to create PayPal order', message: err.message });
    }
});

app.post('/api/paypal/capture-order', checkAuthenticated, async (req, res) => {
    try {
        const { orderID } = req.body;
        if (!orderID) {
            return res.status(400).json({ error: 'Missing PayPal order ID' });
        }

        const capture = await paypal.captureOrder(orderID);
        if (capture && capture.status === 'COMPLETED') {
            const { orderId } = await checkoutController.createOrderFromCart(req);
            return res.json({ success: true, orderId });
        }

        return res.status(400).json({ error: 'Payment not completed', details: capture });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to capture PayPal order', message: err.message });
    }
});

// NETS API routes
app.post('/api/nets/generate-qr', checkAuthenticated, netsQr.generateQrCode);
app.get('/nets-qr/success', checkAuthenticated, (req, res) => {
    res.render('netsTxnSuccessStatus', { message: 'Transaction Successful!' });
});
app.get('/nets-qr/fail', checkAuthenticated, (req, res) => {
    res.render('netsTxnFailStatus', { message: 'Transaction Failed. Please try again.' });
});

// Server-Sent Events endpoint for NETS payment status polling
app.get('/sse/payment-status/:txnRetrievalRef', checkAuthenticated, async (req, res) => {
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const txnRetrievalRef = req.params.txnRetrievalRef;
    let pollCount = 0;
    const maxPolls = 60;
    let frontendTimeoutStatus = 0;

    const interval = setInterval(async () => {
        pollCount++;

        try {
            const response = await axios.post(
                'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/query',
                { txn_retrieval_ref: txnRetrievalRef, frontend_timeout_status: frontendTimeoutStatus },
                {
                    headers: {
                        'api-key': process.env.API_KEY,
                        'project-id': process.env.PROJECT_ID,
                        'Content-Type': 'application/json'
                    }
                }
            );

            res.write(`data: ${JSON.stringify(response.data)}\n\n`);

            const resData = response.data.result.data;

            if (resData.response_code == "00" && resData.txn_status === 1) {
                res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
                clearInterval(interval);
                res.end();
            } else if (frontendTimeoutStatus == 1 && resData && (resData.response_code !== "00" || resData.txn_status === 2)) {
                res.write(`data: ${JSON.stringify({ fail: true, ...resData })}\n\n`);
                clearInterval(interval);
                res.end();
            }
        } catch (err) {
            clearInterval(interval);
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }

        if (pollCount >= maxPolls) {
            clearInterval(interval);
            frontendTimeoutStatus = 1;
            res.write(`data: ${JSON.stringify({ fail: true, error: "Timeout" })}\n\n`);
            res.end();
        }
    }, 5000);

    req.on('close', () => {
        clearInterval(interval);
    });
});

// Define routes
app.get('/',  (req, res) => {
    res.render('index', {user: req.session.user} );
});

// Add meta.json route to fix 404 error
app.get('/meta.json', (req, res) => {
    res.json({});
});

app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    // Fetch data from MySQL
    connection.query('SELECT * FROM products', (error, results) => {
      if (error) throw error;
      res.render('inventory', { 
          products: results, 
          user: req.session.user,
          messages: req.flash('success'),
          errors: req.flash('error')
      });
    });
});

app.get('/login', (req, res) => {
    res.render('auth', { 
        messages: req.flash('success'), 
        errors: req.flash('error'),
        registerErrors: [],
        formData: null
    });
});

app.get('/register', (req, res) => {
    res.render('auth', { 
        messages: [], 
        errors: [],
        registerErrors: req.flash('error'),
        formData: req.flash('formData')[0]
    });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            console.error('Registration error:', err);
            
            if (err.code === 'ER_DUP_ENTRY') {
                req.flash('error', 'Email already exists. Please use a different email or login.');
                req.flash('formData', req.body);
                return res.redirect('/register');
            }
            
            if (err.code === 'ER_DATA_TOO_LONG') {
                req.flash('error', 'One of the fields is too long. Please check your input.');
                req.flash('formData', req.body);
                return res.redirect('/register');
            }
            
            req.flash('error', 'Registration failed. Please try again.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }
        
        console.log('User registered successfully:', result.insertId);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    console.log('Login attempt for:', email); // Debug log

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    connection.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('Login error:', err);
            req.flash('error', 'Login failed. Please try again.');
            return res.redirect('/login');
        }

        console.log('Query results:', results.length); // Debug log

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0]; 
            console.log('User logged in:', req.session.user.username); // Debug log
            
            // Save session before redirect
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                }
                req.flash('success', 'Login successful!');
                if(req.session.user.role === 'user') {
                    res.redirect('/shopping');
                } else {
                    res.redirect('/admin/dashboard'); // Changed from /inventory
                }
            });
        } else {
            // Invalid credentials
            console.log('Invalid credentials for:', email); // Debug log
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    });
});

// Add category column to products table (run this SQL first)
// ALTER TABLE products ADD COLUMN category VARCHAR(50) DEFAULT 'grocery';

app.get('/shopping', checkAuthenticated, (req, res) => {
    const category = req.query.category || '';
    const search = req.query.search || '';
    
    let sql = `SELECT p.*, 
               AVG(r.rating) as avg_rating, 
               COUNT(r.id) as review_count 
               FROM products p 
               LEFT JOIN reviews r ON p.id = r.product_id 
               WHERE 1=1`;
    const params = [];
    
    if (category) {
        sql += ' AND p.category = ?';
        params.push(category);
    }
    
    if (search) {
        sql += ' AND p.productName LIKE ?';
        params.push(`%${search}%`);
    }
    
    sql += ' GROUP BY p.id';
    
    connection.query(sql, params, (error, results) => {
        if (error) throw error;
        res.render('shopping', { 
            user: req.session.user, 
            products: results,
            cart: req.session.cart || [],
            selectedCategory: category,
            searchTerm: search
        });
    });
});

app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            const product = results[0];

            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if product already in cart (using correct id field)
            const existingItem = req.session.cart.find(item => item.id === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    id: product.id,  // Changed from product.productId
                    name: product.productName,  // Changed from productName
                    price: parseFloat(product.price),  // Ensure it's a number
                    quantity: quantity,
                    image: product.image
                });
            }

            req.flash('success', 'Product added to cart!');
            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    let total = 0;
    cart.forEach(item => {
        total += item.price * item.quantity;
    });
    res.render('cart', { 
        cart, 
        user: req.session.user,
        total,  // Add total calculation
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/product/:id', checkAuthenticated, (req, res) => {
    const productId = req.params.id;

    // Fetch product details
    connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            // Fetch reviews for this product
            connection.query(
                `SELECT r.*, u.username 
                 FROM reviews r 
                 JOIN users u ON r.user_id = u.id 
                 WHERE r.product_id = ? 
                 ORDER BY r.created_at DESC`,
                [productId],
                (err, reviews) => {
                    if (err) {
                        console.error('Error fetching reviews:', err);
                        reviews = [];
                    }
                    
                    res.render('product', { 
                        product: results[0], 
                        user: req.session.user,
                        reviews: reviews
                    });
                }
            );
        } else {
            res.status(404).send('Product not found');
        }
    });
});

// Add review route
app.post('/product/:id/review', checkAuthenticated, (req, res) => {
    const productId = req.params.id;
    const userId = req.session.user.id;
    const { rating, review_text } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
        req.flash('error', 'Please provide a valid rating (1-5 stars)');
        return res.redirect('/product/' + productId);
    }

    // Insert review
    const sql = 'INSERT INTO reviews (product_id, user_id, rating, review_text) VALUES (?, ?, ?, ?)';
    connection.query(sql, [productId, userId, rating, review_text], (err, result) => {
        if (err) {
            console.error('Review insert error:', err);
            req.flash('error', 'Failed to submit review');
        } else {
            req.flash('success', 'Thank you for your review!');
        }
        // Redirect to shopping page instead of product page
        res.redirect('/shopping');
    });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', {user: req.session.user } ); 
});

app.post('/addProduct', upload.single('image'),  (req, res) => {
    const { name, quantity, price, category } = req.body;
    let image;
    if (req.file) {
        image = req.file.filename;
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, category, image) VALUES (?, ?, ?, ?, ?)';
    connection.query(sql , [name, quantity, price, category, image], (error, results) => {
        if (error) {
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE id = ?';

    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;

        if (results.length > 0) {
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const productId = req.params.id;
    const { name, quantity, price, category } = req.body;
    let image  = req.body.currentImage;
    if (req.file) {
        image = req.file.filename;
    } 

    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, category = ?, image = ? WHERE id = ?';
    connection.query(sql, [name, quantity, price, category, image, productId], (error, results) => {
        if (error) {
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', (req, res) => {
    const productId = req.params.id;

    connection.query(
        'SELECT COUNT(*) as orderCount FROM order_items WHERE product_id = ?',
        [productId],
        (error, results) => {
            if (error) {
                console.error("Error checking product orders:", error);
                return res.status(500).send('Error checking product');
            }

            const orderCount = results[0].orderCount;

            if (orderCount > 0) {
                req.flash('error', `Cannot delete product. It has been ordered ${orderCount} time(s). Consider marking it as out of stock instead.`);
                return res.redirect('/inventory');
            }

            connection.query('DELETE FROM products WHERE id = ?', [productId], (error, results) => {
                if (error) {
                    console.error("Error deleting product:", error);
                    req.flash('error', 'Error deleting product');
                } else {
                    req.flash('success', 'Product deleted successfully');
                }
                res.redirect('/inventory');
            });
        }
    );
});

app.get('/about', (req, res) => {
    res.render('about', { user: req.session.user });
});

app.get('/contact', (req, res) => {
    res.render('contact', { user: req.session.user });
});

app.post('/contact', (req, res) => {
    const { name, email, subject, message } = req.body;
    console.log('Contact form submission:', { name, email, subject, message });
    req.flash('success', 'Thank you for contacting us! We will get back to you soon.');
    res.redirect('/contact');
});

app.get('/faq', (req, res) => {
    res.render('faq', { user: req.session.user });
});

app.get('/shipping', (req, res) => {
    res.render('shipping', { user: req.session.user });
});

app.get('/returns', (req, res) => {
    res.render('returns', { user: req.session.user });
});

// Admin Dashboard
app.get('/admin/dashboard', checkAuthenticated, checkAdmin, (req, res) => {
    // Get stats
    connection.query('SELECT COUNT(*) as count FROM users', (err, userCount) => {
        connection.query('SELECT COUNT(*) as count FROM products', (err, productCount) => {
            connection.query('SELECT COUNT(*) as count, SUM(total_price) as revenue FROM orders', (err, orderStats) => {
                connection.query('SELECT * FROM products WHERE quantity < 10 ORDER BY quantity ASC LIMIT 5', (err, lowStock) => {
                    connection.query(`
                        SELECT o.*, u.username 
                        FROM orders o 
                        JOIN users u ON o.user_id = u.id 
                        ORDER BY o.order_id DESC LIMIT 5
                    `, (err, recentOrders) => {
                        res.render('adminDashboard', {
                            user: req.session.user,
                            stats: {
                                totalUsers: userCount[0].count,
                                totalProducts: productCount[0].count,
                                totalOrders: orderStats[0].count || 0,
                                totalRevenue: parseFloat(orderStats[0].revenue) || 0
                            },
                            lowStockProducts: lowStock,
                            recentOrders: recentOrders
                        });
                    });
                });
            });
        });
    });
});

// Manage Users
app.get('/admin/users', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query('SELECT * FROM users ORDER BY id DESC', (err, users) => {
        if (err) throw err;
        res.render('manageUsers', {
            user: req.session.user,
            users: users,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

// Delete User (only non-admin users)
app.post('/admin/delete-user/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.id;
    
    // Check if user is admin
    connection.query('SELECT role FROM users WHERE id = ?', [userId], (err, results) => {
        if (err || results.length === 0) {
            req.flash('error', 'User not found');
            return res.redirect('/admin/users');
        }
        
        if (results[0].role === 'admin') {
            req.flash('error', 'Cannot delete admin users');
            return res.redirect('/admin/users');
        }
        
        // Check if user has orders
        connection.query('SELECT COUNT(*) as orderCount FROM orders WHERE user_id = ?', [userId], (err, orderResults) => {
            if (err) {
                console.error('Check orders error:', err);
                req.flash('error', 'Failed to check user orders');
                return res.redirect('/admin/users');
            }
            
            const orderCount = orderResults[0].orderCount;
            
            if (orderCount > 0) {
                req.flash('error', `Cannot delete user. They have ${orderCount} order(s) in the system.`);
                return res.redirect('/admin/users');
            }
            
            // Delete user (no orders)
            connection.query('DELETE FROM users WHERE id = ?', [userId], (err) => {
                if (err) {
                    console.error('Delete user error:', err);
                    req.flash('error', 'Failed to delete user');
                } else {
                    req.flash('success', 'User deleted successfully');
                }
                res.redirect('/admin/users');
            });
        });
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
