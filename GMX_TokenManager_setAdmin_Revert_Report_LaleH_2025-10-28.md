                    🧿 In the Name of God


🛡 GMX Bug Bounty Report — TokenManager `setAdmin` Revert Without Reason



 📌 Summary
This report documents a reproducible issue in the `TokenManager` contract on Arbitrum (Chain ID: 42161), where the `setAdmin` function reverts without a reason string despite valid signal and signatures.

🔍 Steps to Reproduce
1. Signal `setAdmin` with valid parameters  
2. Submit three valid `signSetAdmin` transactions  
3. Confirm `pendingActions[actionHash] == true`  
4. Attempt to execute `setAdmin` → transaction reverts without reason

 📁 Supporting Files
- `TokenManager_SetAdmin_SignalAndSign_42161.txt`  
- `TokenManager_SetAdmin_RevertError_42161.txt`  
- `tx_hashes_42161.log`  
- `TokenManager_SetAdmin_PoC_42161.mp4` (not included in repo)  
- `poc_tokenmanager_setadminh.js`

🔐 Impact
- Admin role cannot be updated despite valid multisig flow  
- No error message is returned  
- Potential governance or upgrade deadlock

 ✅ Environment
- Network: Arbitrum (Chain ID: 42161)  
- Contract: `TokenManager` at `0x4E29d2ee6973E5Bd093df40ef9d0B28BD56C9e4E`  
- Testing Framework: Hardhat + Ethers.js
 🙋‍♀️ Researcher
LaleH😍 — Security Researcher, Blockchain Engineer  
Location: Middle East (GMT+3:30)  
GitHub: [github.com/laleh-nour](https://github.com/laleh-nour)
