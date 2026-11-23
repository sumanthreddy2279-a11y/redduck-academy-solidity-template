
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Token is IERC20 {

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 private _totalSupply;

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;

    error InsufficientBalance();
    error InsufficientAllowance();
    error TransferToZeroAddress();
    error ApproveToZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply
    ) {
        name = name_;
        symbol = symbol_;

        _totalSupply = initialSupply;
        _balances[msg.sender] = initialSupply;

        emit Transfer(address(0), msg.sender, initialSupply);
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function transfer(
        address to,
        uint256 value
    ) external returns (bool) {

        if (to == address(0)) {
            revert TransferToZeroAddress();
        }

        if (_balances[msg.sender] < value) {
            revert InsufficientBalance();
        }

        _balances[msg.sender] -= value;
        _balances[to] += value;

        emit Transfer(msg.sender, to, value);

        return true;
    }

    function approve(
        address spender,
        uint256 value
    ) external returns (bool) {

        if (spender == address(0)) {
            revert ApproveToZeroAddress();
        }

        _allowances[msg.sender][spender] = value;

        emit Approval(msg.sender, spender, value);

        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) external returns (bool) {

        if (to == address(0)) {
            revert TransferToZeroAddress();
        }

        if (_allowances[from][msg.sender] < value) {
            revert InsufficientAllowance();
        }

        if (_balances[from] < value) {
            revert InsufficientBalance();
        }

        _allowances[from][msg.sender] -= value;

        _balances[from] -= value;
        _balances[to] += value;

        emit Transfer(from, to, value);

        return true;
    }
}
