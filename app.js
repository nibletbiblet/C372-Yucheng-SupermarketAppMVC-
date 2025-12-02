const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
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
});

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

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
      res.render('inventory', { products: results, user: req.session.user });
    });
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    connection.query(sql, [username, email, password, address, contact, role], (err, result) => {
        if (err) {
            console.error('Registration error:', err);
            
            // Handle specific errors
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
            
            // Generic error
            req.flash('error', 'Registration failed. Please try again.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }
        
        console.log('User registered successfully:', result.insertId);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
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
                    res.redirect('/inventory');
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
    
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];
    
    if (category) {
        sql += ' AND category = ?';
        params.push(category);
    }
    
    if (search) {
        sql += ' AND productName LIKE ?';
        params.push(`%${search}%`);
    }
    
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
  // Extract the product ID from the request parameters
  const productId = req.params.id;

  // Fetch data from MySQL based on the product ID
  connection.query('SELECT * FROM products WHERE id = ?', [productId], (error, results) => {
      if (error) throw error;

      // Check if any product with the given ID was found
      if (results.length > 0) {
          // Render HTML page with the product data
          res.render('product', { product: results[0], user: req.session.user  });
      } else {
          // If no product with the given ID was found, render a 404 page or handle it accordingly
          res.status(404).send('Product not found');
      }
  });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', {user: req.session.user } ); 
});

app.post('/addProduct', upload.single('image'),  (req, res) => {
    // Extract product data from the request body
    const { name, quantity, price} = req.body;
    let image;
    if (req.file) {
        image = req.file.filename; // Save only the filename
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    // Insert the new product into the database
    connection.query(sql , [name, quantity, price, image], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error adding product:", error);
            res.status(500).send('Error adding product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/updateProduct/:id',checkAuthenticated, checkAdmin, (req,res) => {
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE id = ?';

    // Fetch data from MySQL based on the product ID
    connection.query(sql , [productId], (error, results) => {
        if (error) throw error;

        // Check if any product with the given ID was found
        if (results.length > 0) {
            // Render HTML page with the product data
            res.render('updateProduct', { product: results[0] });
        } else {
            // If no product with the given ID was found, render a 404 page or handle it accordingly
            res.status(404).send('Product not found');
        }
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const productId = req.params.id;
    // Extract product data from the request body
    const { name, quantity, price } = req.body;
    let image  = req.body.currentImage; //retrieve current image filename
    if (req.file) { //if new image is uploaded
        image = req.file.filename; // set image to be new image filename
    } 

    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image =? WHERE id = ?';
    // Insert the new product into the database
    connection.query(sql, [name, quantity, price, image, productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error updating product:", error);
            res.status(500).send('Error updating product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
});

app.get('/deleteProduct/:id', (req, res) => {
    const productId = req.params.id;

    connection.query('DELETE FROM products WHERE id = ?', [productId], (error, results) => {
        if (error) {
            // Handle any error that occurs during the database operation
            console.error("Error deleting product:", error);
            res.status(500).send('Error deleting product');
        } else {
            // Send a success response
            res.redirect('/inventory');
        }
    });
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
