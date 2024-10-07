import express from 'express';
import mysql from 'mysql2/promise';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import OpenAI from 'openai';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3005;

let dbConfig = {}; // Hold database config temporarily

// Configure OpenAI
const openai = new OpenAI({
  apiKey: ''
});

app.use(bodyParser.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// Endpoint to configure database
app.post('/configure-db', async (req, res) => {
  const { dbHost, dbName, dbUser, dbPassword } = req.body;

  dbConfig = {
    host: dbHost,
    database: dbName,
    user: dbUser,
    password: dbPassword
  };

  try {
    const connection = await mysql.createConnection(dbConfig);
    await connection.close();
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Endpoint to get stock prices and generate plot
app.post('/plot-stock', async (req, res) => {
  const { symbol, startDate, endDate } = req.body;

  try {
      const connection = await mysql.createConnection(dbConfig);

      // Get table and column information
      const [tables] = await connection.execute('SHOW TABLES');
      const tableName = tables[0][Object.keys(tables[0])[0]];

      const [columns] = await connection.execute(`SHOW COLUMNS FROM ${tableName}`);
      const columnNames = columns.map(column => column.Field);

      if (!columnNames.includes('stock_code') || !columnNames.includes('date') || !columnNames.includes('close')) {
          throw new Error('Required columns not found in the table.');
      }

      const [rows] = await connection.execute(
          `SELECT date, close FROM ${tableName} WHERE stock_code = ? AND date BETWEEN ? AND ? ORDER BY date`,
          [symbol, startDate, endDate]
      );

      // Check if data is available
      if (rows.length === 0) {
          return res.status(404).json({ error: `No data available for ${symbol} between ${startDate} and ${endDate}` });
      }

      // Generate CSV data with headers and correct date format
      const csvData = 'date,close\n' + rows.map(row => `${new Date(row.date).toISOString().split('T')[0]},${row.close}`).join('\n');
      const csvFilePath = path.join(__dirname, 'stock_data.csv');
      fs.writeFileSync(csvFilePath, csvData);

      const scriptPath = path.join(__dirname, 'plot_stock.py');
      exec(`python3 ${scriptPath} ${csvFilePath} ${symbol} ${startDate} ${endDate}`, (error, stdout, stderr) => {
          if (error) {
              console.error(`exec error: ${error}`);
              return res.status(500).json({ error: 'Error generating plot' });
          }
          if (stderr) {
              console.error(`stderr: ${stderr}`);
          }
          console.log(`stdout: ${stdout}`);
          res.sendFile(path.join(__dirname, 'public', 'stock_plot.png'));
      });

  } catch (error) {
      console.error('Error:', error.message);
      res.status(500).json({ error: error.message });
  }
});

// Endpoint to submit queries
app.post('/submit-query', async (req, res) => {
  const userInput = req.body.userInput;

  try {
    console.log('Trying to connect to the database...');

    const connection = await mysql.createConnection(dbConfig);

    console.log('Connected to the database.');

    // Get database table structure
    const [tables] = await connection.query('SHOW TABLES');
    const tableSchema = {};

    for (const row of tables) {
      const tableName = row[`Tables_in_${dbConfig.database}`];
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${tableName}`);
      tableSchema[tableName] = columns;
    }

    const schemaDescription = Object.entries(tableSchema).map(([table, columns]) => {
      const columnsDescription = columns.map(col => `${col.Field} ${col.Type}`).join(', ');
      return `Table ${table}: ${columnsDescription}`;
    }).join('\n');

    // Generate SQL query using GPT-4 Turbo
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        { role: 'system', content: `The database schema is as follows:\n${schemaDescription}` },
        { role: 'user', content: `Generate a syntactically correct SQL query for the following prompt: "${userInput}"\nOnly provide the SQL query without any additional text or Markdown.` }
      ],
      max_tokens: 500,
    });

    let sqlQuery = completion.choices[0].message.content.trim();

    // Remove possible Markdown formatting
    sqlQuery = sqlQuery.replace(/```sql|```/g, '').trim();

    console.log('Generated SQL Query:', sqlQuery);

    // Check if the generated query only contains SQL statements
    const validSQLKeywords = ['select', 'insert', 'update', 'delete'];
    const isValidSQL = validSQLKeywords.some(keyword => sqlQuery.toLowerCase().startsWith(keyword));

    if (!isValidSQL) {
      throw new Error('Generated text is not a valid SQL query.');
    }

    // Execute SQL query
    const [results] = await connection.query(sqlQuery);
    console.log(results)
    const response = {
      data: results,
      query_generated: sqlQuery
    };

    connection.end();
    res.json(response);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for GPT chat
app.post('/gpt-chat', async (req, res) => {
  const userInput = req.body.userInput;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: userInput }
      ],
      max_tokens: 4000,
    });

    const response = {
      response: completion.choices[0].message.content.trim()
    };

    res.json(response);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
