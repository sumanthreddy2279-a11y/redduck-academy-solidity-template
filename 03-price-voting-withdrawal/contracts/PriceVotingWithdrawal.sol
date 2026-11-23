
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PriceVotingWithdrawal {
    IERC20 public immutable token;
    uint256 public immutable votingEnd;

    // Limits finalization to a fixed maximum number of prices.
    uint256 public constant MAX_PRICES = 100;

    mapping(uint256 => uint256) private _weights;
    mapping(address => mapping(uint256 => uint256)) private _locked;

    uint256[] private _prices;
    mapping(uint256 => bool) private _priceExists;

    uint256 private _winningPrice;
    uint256 private _winningWeight;
    bool public finalized;

    error VotingEnded();
    error VotingActive();
    error AlreadyFinalized();
    error ZeroAmount();
    error InsufficientLocked();
    error TransferFailed();
    error MaxPricesReached();

    event Voted(address indexed voter, uint256 indexed price, uint256 amount);
    event Withdrawn(address indexed voter, uint256 indexed price, uint256 amount);
    event Finalized(uint256 winningPrice, uint256 winningWeight);

    constructor(IERC20 token_, uint256 votingEnd_) {
        token = token_;
        votingEnd = votingEnd_;
    }

    function vote(uint256 price, uint256 amount) external {
        if (block.timestamp >= votingEnd) revert VotingEnded();
        if (finalized) revert AlreadyFinalized();
        if (amount == 0) revert ZeroAmount();

        // Reject new prices once the fixed limit is reached.
        if (!_priceExists[price] && _prices.length >= MAX_PRICES) {
            revert MaxPricesReached();
        }

        bool success = token.transferFrom(
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
        _locked[msg.sender][price] += amount;

        emit Voted(msg.sender, price, amount);
    }

    function withdraw(uint256 price, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256 lockedAmount = _locked[msg.sender][price];

        if (amount > lockedAmount) revert InsufficientLocked();

        // Checks-effects-interactions.
        _locked[msg.sender][price] = lockedAmount - amount;
        _weights[price] -= amount;

        bool success = token.transfer(msg.sender, amount);
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, price, amount);
    }

    function finalize() external {
        if (block.timestamp < votingEnd) revert VotingActive();
        if (finalized) revert AlreadyFinalized();

        uint256 highestWeight = 0;
        uint256 selectedPrice = 0;

        // The number of iterations is bounded by MAX_PRICES.
        // Strictly greater preserves first-voted-price tie-breaking.
        for (uint256 i = 0; i < _prices.length; i++) {
            uint256 price = _prices[i];
            uint256 weight = _weights[price];

            if (weight > highestWeight) {
                highestWeight = weight;
                selectedPrice = price;
            }
        }

        _winningPrice = selectedPrice;
        _winningWeight = highestWeight;
        finalized = true;

        emit Finalized(selectedPrice, highestWeight);
    }

    function winner()
        external
        view
        returns (uint256 price, uint256 weight)
    {
        if (!finalized) revert VotingActive();

        return (_winningPrice, _winningWeight);
    }

    function weightOf(uint256 price) external view returns (uint256) {
        return _weights[price];
    }

    function lockedOf(
        address voter,
        uint256 price
    ) external
        view
        returns (uint256)
    {
        return _locked[voter][price];
    }
}
