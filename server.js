const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { poolPromise, sql } = require('./db');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// --- Master Data Endpoints ---

// Get all products
app.get('/api/products', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM S6_WeightBridge_Products');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all vendors
app.get('/api/vendors', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM S6_WeightBridge_Vendors');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all vehicles
app.get('/api/vehicles', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT * FROM S6_WeightBridge_Vehicles');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Product Prices Endpoints ---

// Get all product prices
app.get('/api/product-prices', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT pp.*, p.ProductName, p.ProductCode 
            FROM S6_WeightBridge_ProductPrices pp
            LEFT JOIN S6_WeightBridge_Products p ON pp.ProductID = p.ProductID
            ORDER BY pp.EffectiveDate DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create product price (UPSERT)
app.post('/api/product-prices', async (req, res) => {
    try {
        const { ProductID, EffectiveDate, ToDate, UnitPrice } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('ProductID', sql.Int, ProductID)
            .input('EffectiveDate', sql.Date, EffectiveDate)
            .input('ToDate', sql.Date, ToDate || null)
            .input('UnitPrice', sql.Decimal(10, 2), UnitPrice)
            .query(`
                IF EXISTS (SELECT 1 FROM S6_WeightBridge_ProductPrices WHERE ProductID = @ProductID AND EffectiveDate = @EffectiveDate)
                BEGIN
                    UPDATE S6_WeightBridge_ProductPrices 
                    SET UnitPrice = @UnitPrice, ToDate = @ToDate 
                    WHERE ProductID = @ProductID AND EffectiveDate = @EffectiveDate
                END
                ELSE
                BEGIN
                    INSERT INTO S6_WeightBridge_ProductPrices (ProductID, EffectiveDate, ToDate, UnitPrice)
                    VALUES (@ProductID, @EffectiveDate, @ToDate, @UnitPrice)
                END
            `);
        res.status(201).json({ message: 'Price set successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update product price by ID
app.put('/api/product-prices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { ProductID, EffectiveDate, ToDate, UnitPrice } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('PriceID', sql.Int, id)
            .input('ProductID', sql.Int, ProductID)
            .input('EffectiveDate', sql.Date, EffectiveDate)
            .input('ToDate', sql.Date, ToDate || null)
            .input('UnitPrice', sql.Decimal(10, 2), UnitPrice)
            .query(`
                UPDATE S6_WeightBridge_ProductPrices 
                SET ProductID = ISNULL(@ProductID, ProductID),
                    EffectiveDate = ISNULL(@EffectiveDate, EffectiveDate),
                    ToDate = @ToDate,
                    UnitPrice = ISNULL(@UnitPrice, UnitPrice)
                WHERE PriceID = @PriceID
            `);
        res.json({ message: 'Price updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete product price
app.delete('/api/product-prices/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPromise;
        await pool.request()
            .input('PriceID', sql.Int, id)
            .query('DELETE FROM S6_WeightBridge_ProductPrices WHERE PriceID = @PriceID');
        res.json({ message: 'Price deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get active price for a product on a specific date
app.get('/api/product-prices/active/:productId', async (req, res) => {
    try {
        const { productId } = req.params;
        const { date } = req.query; // Expected format: YYYY-MM-DD
        const targetDate = date || new Date().toISOString().split('T')[0];

        const pool = await poolPromise;
        const result = await pool.request()
            .input('ProductID', sql.Int, productId)
            .input('TargetDate', sql.Date, targetDate)
            .query(`
                SELECT TOP 1 pp.*, p.ProductName, p.ProductCode
                FROM S6_WeightBridge_ProductPrices pp
                LEFT JOIN S6_WeightBridge_Products p ON pp.ProductID = p.ProductID
                WHERE pp.ProductID = @ProductID
                  AND pp.EffectiveDate <= @TargetDate
                  AND (pp.ToDate IS NULL OR pp.ToDate >= @TargetDate)
                ORDER BY pp.EffectiveDate DESC
            `);

        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.status(404).json({ error: 'No active price found for this product on the specified date' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Ticket Endpoints ---

// Get all tickets
app.get('/api/tickets', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT t.*, p.ProductName, v.VendorName, vh.LicensePlate 
            FROM S6_WeightBridge_WeighTickets t
            LEFT JOIN S6_WeightBridge_Products p ON t.ProductID = p.ProductID
            LEFT JOIN S6_WeightBridge_Vendors v ON t.VendorID = v.VendorID
            LEFT JOIN S6_WeightBridge_Vehicles vh ON t.VehicleID = vh.VehicleID
            ORDER BY t.TimeIn DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new ticket
app.post('/api/tickets', async (req, res) => {
    try {
        const {
            TicketNo, VehicleID, VendorID, ProductID, PaymentType,
            WeightIn, WeightOut, UnitPrice, CreatedBy, Remarks
        } = req.body;

        const pool = await poolPromise;
        await pool.request()
            .input('TicketNo', sql.VarChar, TicketNo)
            .input('VehicleID', sql.Int, VehicleID)
            .input('VendorID', sql.Int, VendorID)
            .input('ProductID', sql.Int, ProductID)
            .input('ProcessStatus', sql.VarChar, 'pending')
            .input('PaymentType', sql.VarChar, PaymentType)
            .input('WeightIn', sql.Decimal(10, 2), WeightIn)
            .input('WeightOut', sql.Decimal(10, 2), WeightOut)
            .input('UnitPrice', sql.Decimal(10, 2), UnitPrice)
            .input('TimeIn', sql.DateTime2, new Date())
            .input('CreatedBy', sql.VarChar, CreatedBy)
            .input('Remarks', sql.VarChar, Remarks)
            .query(`
                INSERT INTO S6_WeightBridge_WeighTickets 
                (TicketNo, VehicleID, VendorID, ProductID, ProcessStatus, PaymentType, WeightIn, WeightOut, UnitPrice, TimeIn, CreatedBy, Remarks)
                VALUES (@TicketNo, @VehicleID, @VendorID, @ProductID, @ProcessStatus, @PaymentType, @WeightIn, @WeightOut, @UnitPrice, @TimeIn, @CreatedBy, @Remarks)
            `);
        res.status(201).json({ message: 'Ticket created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update ticket (Approve)
app.patch('/api/tickets/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await poolPromise;
        await pool.request()
            .input('TicketID', sql.BigInt, id)
            .query('UPDATE S6_WeightBridge_WeighTickets SET ProcessStatus = \'approved\', TimeOut = GETDATE() WHERE TicketID = @TicketID');
        res.json({ message: 'Ticket approved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
