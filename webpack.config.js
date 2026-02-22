const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  devtool: "source-map",
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist"),
    clean: true
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }]
  },
  devServer: {
    static: [
      { directory: path.join(__dirname, "public") },
      { directory: path.join(__dirname, "dist") }
    ],
    port: 5177,
    hot: true
  }
};
