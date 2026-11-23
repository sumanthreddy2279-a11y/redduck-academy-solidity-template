
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract Raffle is VRFConsumerBaseV2Plus {
    IERC20 public immutable token;
    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable drawTime;

    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint32 public immutable callbackGasLimit;

    uint16 public constant REQUEST_CONFIRMATIONS = 3;
    uint32 public constant NUM_WORDS = 1;
    uint256 public constant MAX_PRICE_AGE = 1 hours;

    struct Entry {
        address player;
        uint256 amount;
        uint256 weight;
        uint256 cumulativeWeight;
    }

    Entry[] public entries;

    uint256 public totalWeight;
    uint256 public totalDeposited;
    uint256 public requestId;
    uint256 public randomWord;

    bool public drawRequested;
    bool public randomnessFulfilled;
    bool public claimed;

    address public winner;
    uint256 public winningEntryIndex;

    error InvalidClaim();
    error InvalidAmount();
    error RaffleClosed();
    error RaffleNotClosed();
    error NoEntries();
    error InvalidPrice();
    error StalePrice();
    error DrawAlreadyRequested();
    error InvalidRequest();
    error RandomnessNotReady();
    error TransferFailed();

    event Deposited(address indexed who, uint256 amount, uint256 weight);
    event DrawRequested(uint256 requestId);
    event WinnerPicked(address indexed winner);
    event Claimed(address indexed winner, uint256 amount);

    constructor(
        IERC20 _token,
        AggregatorV3Interface _priceFeed,
        uint256 _drawTime,
        address _coordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash,
        uint32 _callbackGasLimit
    ) VRFConsumerBaseV2Plus(_coordinator) {
        token = _token;
        priceFeed = _priceFeed;
        drawTime = _drawTime;
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        callbackGasLimit = _callbackGasLimit;
    }

    function deposit(uint256 amount) external {
        if (block.timestamp >= drawTime || drawRequested) {
            revert RaffleClosed();
        }

        if (amount == 0) {
            revert InvalidAmount();
        }

        (
            ,
            int256 price,
            ,
            uint256 updatedAt,

        ) = priceFeed.latestRoundData();

        if (price <= 0 || updatedAt == 0) {
            revert InvalidPrice();
        }

        if (
            updatedAt > block.timestamp ||
            block.timestamp - updatedAt > MAX_PRICE_AGE
        ) {
            revert StalePrice();
        }

        uint8 feedDecimals = priceFeed.decimals();

        // Convert the deposit into USD-weight units.
        // The deposit token is assumed to use 18 decimals.
        uint256 weight =
            (amount * uint256(price)) /
            (10 ** uint256(feedDecimals));

        if (weight == 0) {
            revert InvalidAmount();
        }

        bool success = token.transferFrom(
            msg.sender,
            address(this),
            amount
        );

        if (!success) {
            revert TransferFailed();
        }
        totalDeposited += amount;

        totalWeight += weight;

        entries.push(
            Entry({
                player: msg.sender,
                amount: amount,
                weight: weight,
                cumulativeWeight: totalWeight
            })
        );

        emit Deposited(msg.sender, amount, weight);
    }

    function drawWinner() external returns (uint256) {
        if (block.timestamp < drawTime) {
            revert RaffleNotClosed();
        }

        if (entries.length == 0 || totalWeight == 0) {
            revert NoEntries();
        }

        if (drawRequested) {
            revert DrawAlreadyRequested();
        }

        drawRequested = true;

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: callbackGasLimit,
                numWords: NUM_WORDS,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({
                        nativePayment: false
                    })
                )
            })
        );

        emit DrawRequested(requestId);

        return requestId;
    }

    function fulfillRandomWords(
        uint256 _requestId,
        uint256[] calldata randomWords
    ) internal override {
        if (!drawRequested || _requestId != requestId) {
            revert InvalidRequest();
        }

        if (randomnessFulfilled || randomWords.length == 0) {
            revert InvalidRequest();
        }

        randomWord = randomWords[0];
        randomnessFulfilled = true;
    }

    function getWinningEntryIndex() public view returns (uint256) {
        if (!randomnessFulfilled || totalWeight == 0) {
            revert RandomnessNotReady();
        }

        uint256 target = randomWord % totalWeight;

        // Binary search over cumulative weights.
        uint256 low = 0;
        uint256 high = entries.length;

        while (low < high) {
            uint256 mid = low + (high - low) / 2;

            if (target < entries[mid].cumulativeWeight) {
                high = mid;
            } else {
                low = mid + 1;
            }
        }

        return low;
    }

    function claim(uint256 entryIndex) external {
        if (
            claimed ||
            !randomnessFulfilled ||
            entryIndex >= entries.length
        ) {
            revert InvalidClaim();
        }

        uint256 selectedIndex = getWinningEntryIndex();

        if (
            entryIndex != selectedIndex ||
            entries[entryIndex].player != msg.sender
        ) {
            revert InvalidClaim();
        }

        claimed = true;
        winningEntryIndex = selectedIndex;
        winner = msg.sender;

        uint256 prize = token.balanceOf(address(this));

        emit WinnerPicked(msg.sender);

        bool success = token.transfer(msg.sender, prize);

        if (!success) {
            revert TransferFailed();
        }

        emit Claimed(msg.sender, prize);
    }
}
