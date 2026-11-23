// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MerkleAirdrop {
    IERC20 public immutable token;
    bytes32 public immutable merkleRoot;
    address public immutable signer;

    mapping(address => bool) public hasClaimed;

    uint256 private constant SECP256K1N_DIV_2 = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    error AlreadyClaimed();
    error InvalidProof();
    error InvalidSignature();
    error TransferFailed();

    event Claimed(address indexed account, uint256 amount);

    constructor(IERC20 _token, bytes32 _merkleRoot, address _signer) {
        token = _token;
        merkleRoot = _merkleRoot;
        signer = _signer;
    }

    function claim(uint256 amount, bytes32[] calldata proof) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));

        if (!_verify(proof, leaf)) revert InvalidProof();

        hasClaimed[msg.sender] = true;

        if (!token.transfer(msg.sender, amount)) {
            revert TransferFailed();
        }

        emit Claimed(msg.sender, amount);
    }

    function claimWithSignature(uint256 amount, uint8 v, bytes32 r, bytes32 s) external {
        if (hasClaimed[msg.sender]) revert AlreadyClaimed();

        if (uint256(s) > SECP256K1N_DIV_2 || (v != 27 && v != 28)) {
            revert InvalidSignature();
        }

        bytes32 messageHash = keccak256(abi.encode(address(this), block.chainid, msg.sender, amount));

        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        address recoveredSigner = ecrecover(ethSignedHash, v, r, s);

        if (recoveredSigner == address(0) || recoveredSigner != signer) {
            revert InvalidSignature();
        }

        hasClaimed[msg.sender] = true;

        if (!token.transfer(msg.sender, amount)) {
            revert TransferFailed();
        }

        emit Claimed(msg.sender, amount);
    }

    function _verify(bytes32[] calldata proof, bytes32 leaf) internal view returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == merkleRoot;
    }
}
