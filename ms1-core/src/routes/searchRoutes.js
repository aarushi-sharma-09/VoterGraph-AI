const express = require('express');
const { searchBooth } = require('../controllers/searchController');
const router = express.Router();

router.get('/booth', searchBooth);

module.exports = router;
