Imminenti
---------
Simple deadline manager

### Setup
Before building the app, prepare the dependencies.

Build Cargo packages with
```sh
cd src-tauri
cargo build
```

Download and install NPM packages with
```sh
cd ..
npm install
```

### Development
To launch the development build, run
```sh
npm run tauri dev
```

### Release build
For the release build, within the root directory run
```sh
npm run tauri build
```
The standalone binary executable will be located at `src-tauri/target/release/imminenti`.

You can then install it locally:
```sh
sudo install -Dm755 ./src-tauri/target/release/imminenti /usr/local/bin/imminenti
```
