name: IFCDC App Deployment

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Dependencies
        run: npm install

      - name: Run Tests (Optional)
        run: npm test

      - name: Build App
        run: npm run build

      - name: Deploy (Optional)
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          echo "Deployment Step Here"
          # Example: scp -r ./build user@server:/path/to/deploy
