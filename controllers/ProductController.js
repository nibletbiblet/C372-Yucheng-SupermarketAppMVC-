const Product = require('../models/Product');

const ProductController = {
	// GET /products
	listAll(req, res) {
		const filters = {}; // optionally read from req.query if needed
		if (req.query && req.query.category) filters.category = req.query.category;

		Product.getAllProducts(filters, (err, products) => {
			if (err) return res.status(500).send('Failed to load products');
			return res.render('products/list', { products });
		});
	},

	// GET /products/:id
	getById(req, res) {
		const id = req.params.id;
		Product.getProductById(id, (err, product) => {
			if (err) return res.status(500).send('Failed to load product');
			if (!product) return res.status(404).send('Product not found');
			return res.render('products/detail', { product });
		});
	},

	// GET /products/add
	showAddForm(req, res) {
		return res.render('products/add');
	},

	// POST /products/add
	add(req, res) {
		const product = {
			productName: req.body.productName,
			price: req.body.price,
			category: req.body.category,
			image: req.body.image
		};

		Product.addProduct(product, (err, info) => {
			if (err) return res.status(500).send('Failed to add product');
			return res.redirect('/products');
		});
	},

	// GET /products/:id/edit
	showEditForm(req, res) {
		const id = req.params.id;
		Product.getProductById(id, (err, product) => {
			if (err) return res.status(500).send('Failed to load product for edit');
			if (!product) return res.status(404).send('Product not found');
			return res.render('products/edit', { product });
		});
	},

	// POST /products/:id/edit
	update(req, res) {
		const id = req.params.id;
		const params = {
			productId: id,
			productName: req.body.productName,
			price: req.body.price,
			category: req.body.category,
			image: req.body.image
		};

		Product.updateProduct(params, (err, info) => {
			if (err) return res.status(500).send('Failed to update product');
			return res.redirect('/products');
		});
	},

	// POST /products/:id/delete  (or DELETE /products/:id)
	delete(req, res) {
		const id = req.params.id;
		Product.deleteProduct(id, (err, info) => {
			if (err) return res.status(500).send('Failed to delete product');
			return res.redirect('/products');
		});
	}
};

module.exports = ProductController;
