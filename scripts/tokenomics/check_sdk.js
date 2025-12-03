// Check the DLMM SDK methods
const DLMM = require("@meteora-ag/dlmm");

const DLMMClass = DLMM.default || DLMM;

console.log("🔍 DLMM SDK Analysis\n");

// List all exports
console.log("Exports:", Object.keys(DLMMClass).join(", "));

// Check for static methods
console.log("\n📋 Static Methods:");
for (const key of Object.keys(DLMMClass)) {
  if (typeof DLMMClass[key] === 'function') {
    const fn = DLMMClass[key];
    console.log(`  ${key}: ${fn.length} args`);
  }
}

// Check for prototype methods if it's a class
if (DLMMClass.prototype) {
  console.log("\n📋 Instance Methods:");
  for (const key of Object.getOwnPropertyNames(DLMMClass.prototype)) {
    if (key !== 'constructor') {
      console.log(`  ${key}`);
    }
  }
}

// Print createLbPair signature if exists
if (DLMMClass.createLbPair) {
  console.log("\n🔧 createLbPair function:");
  console.log(DLMMClass.createLbPair.toString().slice(0, 500));
}

// Check for createPermissionlessLbPair
if (DLMMClass.createPermissionlessLbPair) {
  console.log("\n🔧 createPermissionlessLbPair function:");
  console.log(DLMMClass.createPermissionlessLbPair.toString().slice(0, 500));
}

