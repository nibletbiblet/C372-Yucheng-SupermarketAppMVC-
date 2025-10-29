const db = require('../db');

const Product = {
	// params: optional filters object (e.g., { category: 'Fruit' })
	// callback: function(err, resultsArray)
	getAllProducts(params, callback) {
		let sql = 'SELECT * FROM products';
		const values = [];

		// optional simple filter by category
		if (params && params.category) {
			sql += ' WHERE category = ?';
			values.push(params.category);
		}

		db.query(sql, values, (err, results) => {
			if (err) return callback(err);
			return callback(null, results);
		});
	},

	// params: productId (number or string)
	// callback: function(err, productObject)
	getProductById(productId, callback) {
		db.query('SELECT * FROM products WHERE productId = ?', [productId], (err, results) => {
			if (err) return callback(err);
			return callback(null, results && results.length ? results[0] : null);
		});
	},

	// params: product object { productName, price, category, image }
	// callback: function(err, insertInfo)
	addProduct(product, callback) {
		const { productName, price, category, image } = product || {};
		const sql = 'INSERT INTO products (productName, price, category, image) VALUES (?, ?, ?, ?)';
		db.query(sql, [productName, price, category, image], (err, result) => {
			if (err) return callback(err);
			return callback(null, { insertId: result.insertId, affectedRows: result.affectedRows });
		});
	},

	// params: object with productId and fields to update, e.g.
	// { productId: 1, productName: 'New', price: 9.99, category: 'X', image: 'url' }
	// callback: function(err, updateInfo)
	updateProduct(params, callback) {
		if (!params || params.productId === undefined) {
			return callback(new Error('productId is required for update'));
		}

		const productId = params.productId;
		const fields = [];
		const values = [];

		// build dynamic set clause for only provided fields
		['productName', 'price', 'category', 'image'].forEach((key) => {
			if (params[key] !== undefined) {
				fields.push(`${key} = ?`);
				values.push(params[key]);
			}
		});

		if (fields.length === 0) {
			// nothing to update
			return callback(null, { affectedRows: 0 });
		}

		const sql = `UPDATE products SET ${fields.join(', ')} WHERE productId = ?`;
		values.push(productId);

		db.query(sql, values, (err, result) => {
			if (err) return callback(err);
			return callback(null, { affectedRows: result.affectedRows, changedRows: result.changedRows });
		});
	},

	// params: productId
	// callback: function(err, deleteInfo)
	deleteProduct(productId, callback) {
		db.query('DELETE FROM products WHERE productId = ?', [productId], (err, result) => {
			if (err) return callback(err);
			return callback(null, { affectedRows: result.affectedRows });
		});
	}
};

module.exports = Product;
