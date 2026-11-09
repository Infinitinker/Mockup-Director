#!/bin/sh
# Starts Mockup Director from this checkout, without building an installer: the desktop app with
# hot reload (npm run app:dev). Stop it with Ctrl+C or by closing the app. Node.js and Rust must
# be installed first, on Linux also the WebKitGTK development packages (see docs/development.md).
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
    echo "Node.js (npm) was not found: install it as docs/development.md describes." >&2
    exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
    echo "Rust (cargo) was not found: install it as docs/development.md describes." >&2
    exit 1
fi

# Install the npm packages on the first start, and again whenever package-lock.json is newer than
# npm's record of the last install (after a pull that changed the dependencies).
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    echo "Installing the npm packages..."
    npm ci || exit 1
fi

exec npm run app:dev
