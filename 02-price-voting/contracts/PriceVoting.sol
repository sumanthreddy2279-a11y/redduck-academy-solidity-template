
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PriceVoting {
    IERC20 private _token;
    uint256 private _votingEnd;

    mapping(uint256 => uint256) private _weights;
    mapping(address => uint256) private _locked;

    uint256[] private _prices;
    mapping(uint256 => bool) private _priceExists;

    uint256 private _leaderPrice;
    uint256 private _leaderWeight;
    uint256 private _currentTokenPrice;
    bool private _finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error NothingToClaim();
    error TransferFailed();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event PriceFinalized(uint256 indexed price, uint256 weight);
    event Claimed(address indexed voter, uint256 amount);

    constructor(IERC20 token_, uint256 votingEnd_) {
        _token = token_;
        _votingEnd = votingEnd_;
    }

    // ----- write -----

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= _votingEnd) revert VotingEnded();
        if (_finalized) revert AlreadyFinalized();
        if (amount == 0) revert ZeroAmount();

        bool success = _token.transferFrom(
            msg.sender,
            address(this),
            amount
        );

        if (!success) revert TransferFailed();

        if (!_priceExists[price]) {
            _priceExists[price] = true;
            _prices.push(price);
        }

        _weights[price] += amount;
        _locked[msg.sender] += amount;

        _updateLeader();

        emit Voted(msg.sender, price, amount);
    }

    function _updateLeader() internal {
        uint256 highestWeight = 0;
        uint256 winningPrice = 0;
        uint256 count = 0;

        for (uint256 i = 0; i < _prices.length; i++) {
            uint256 price = _prices[i];
            uint256 weight = _weights[price];

            if (weight > highestWeight) {
                highestWeight = weight;
                winningPrice = price;
                count = 1;
            } else if (weight == highestWeight) {
                count++;
            }
        }

        // Keep the previous leader if there is a tie.
        if (count == 1 && highestWeight > 0) {
            _leaderPrice = winningPrice;
            _leaderWeight = highestWeight;
        }
    }

    function finalize() external {
        if (block.timestamp < _votingEnd) revert VotingActive();
        if (_finalized) revert AlreadyFinalized();

        _finalized = true;

        uint256 highestWeight = 0;
        uint256 winningPrice = 0;
        uint256 count = 0;

        for (uint256 i = 0; i < _prices.length; i++) {
            uint256 price = _prices[i];
            uint256 weight = _weights[price];

            if (weight > highestWeight) {
                highestWeight = weight;
                winningPrice = price;
                count = 1;
            } else if (weight == highestWeight) {
                count++;
            }
        }

        // A unique winner is required to change the price.
        if (count == 1 && highestWeight > 0) {
            _currentTokenPrice = winningPrice;
            emit PriceFinalized(winningPrice, highestWeight);
        }
    }

    function claim() external {
        if (block.timestamp < _votingEnd) revert VotingActive();

        uint256 amount = _locked[msg.sender];

        if (amount == 0) revert NothingToClaim();

        _locked[msg.sender] = 0;

        bool success = _token.transfer(msg.sender, amount);

        if (!success) revert TransferFailed();

        emit Claimed(msg.sender, amount);
    }

    // ----- read -----

    function token() external view returns (IERC20) {
        return _token;
    }

    function votingEnd() external view returns (uint256) {
        return _votingEnd;
    }

    function weightOf(uint256 price) external view returns (uint256) {
        return _weights[price];
    }

    function lockedOf(address voter) external view returns (uint256) {
        return _locked[voter];
    }

    function leader() external view returns (uint256 price, uint256 weight) {
        return (_leaderPrice, _leaderWeight);
    }

    function currentTokenPrice() external view returns (uint256) {
        return _currentTokenPrice;
    }

    function finalized() external view returns (bool) {
        return _finalized;
    }
}
