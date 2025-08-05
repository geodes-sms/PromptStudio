# Prompt Studio

---

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)

---

## Installation

Instructions to install the project:
To run this project, you need to have Node.js and MySQL installed.

1. Create the database running the SQL script in `backend/dababase/db.sql`.
2. Install the dependencies
```bash
cd promptstudio
npm install
```

## Usage
To run the project:
1. You need to have a file called `credentials.json` located in the root of the project. This file contained your api keys
for LLMs, and it should contains your database credentials.
The format should be like this:
```json
{
    "database": {
        "host": "localhost",
        "user": "root",
        "password": "your_password",
        "database": "promptstudio",
        "port": 3306
    },
   "api_keys": {
        "OpenAI": "your_openai_api_key",
        "Google": "your_google_api_key"
   }
}
```

2. You also need to have a YML file containing the configuration of the experiment you want to run.
You should place the file and all his corresponding files in the `files` folder. The file folder should have the datasets in the csv format
and code files like processors and evaluators.
The format of the configuration can be imported from ChainForge.
3. You need to be running the backend server. To do so, run the following command:
```bash
cd backend/api
tsx api.ts
```
4. Finally, you can run an experiment with the following command:
```bash
cd headless
tsx cli.ts -c ../files/YOUR_CONFIG_FILE_NAME.yml
```
To start again an existing experiment you can do:
```bash
tsx cli.ts -n YOUR_EXPERIMENT_NAME
```