//SPDX-Lisense-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol"; //yarn add --dev @chainlink/contracts ==> interface
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffke__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/* @title A sample Raffle Contract
 * @author Haven Dewart
 * @notice This contract is for creating an untamperable decentralized smart contract
 * @dev This implements Chanlink VRF V2 and Chainlink Keepers
 */

/*this lets us inherite all funtionality from VRFConsumerBaseV2. When a contract inherits from other contracts, 
only a single contract is created on the blockchain, and the code from all the base contracts is compiled into 
the created contract. This means that all internal calls to functions of base contracts also just use internal function call*/

contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
    /* Typle declarations*/
    enum RaffleState {
        OPEN,
        CALCULATING
    }

    /*State Veriables*/
    uint256 private immutable i_entranceFee; //this is immutable so we can save some gas. i stands for immutable
    address payable[] private s_players; //s stands for storage. This variable has to be in storage because we are modifying it alot
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator; //here we match an ABI/VRFCoordinatorV2Interface with a var so that we can use VRFCoordinatorV2Interface as our only reference to that contract
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;

    // Lottery Variables
    address private s_recentWinner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimeStamp;
    uint256 private immutable i_interval;

    /*Events*/
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    /* Functions */
    constructor(
        //we pass all of our args into this constructor, then they are used in the VRF constructor as values for our global vars
        address vrfCoordinatorV2,
        uint64 subscriptionId,
        bytes32 gasLane, // keyHash
        uint256 interval,
        uint256 entranceFee,
        uint32 callbackGasLimit
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2); //we use the VRFCoordinatorV2Interface which tells us what funtion parameters the vrfCoordinatorV2 contract takes. Then when we provide the address of the vrfCoordinatorV2 contracts address we can interact with that contract fully
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    //Importing an interface would allow you to declare variables of an interface type to interact with contracts using the interface.

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        } //reverting with a custom error saves gas because storing a string = $
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__NotOpen();
        }
        s_players.push(payable(msg.sender)); //typecasting the msg.sender as a payable address
        emit RaffleEnter(msg.sender);
    }

    /*
     * @dev This is the funtion that the Chaonlink Keeper nodes call they look for the upkeepNedded to return true.
     * The following should be true in order to return true:
     * 1. our time interval should have passed
     * 2. the lottery should have at least 1 player, and have some ETH
     * 3. our subscrioption is funded with link
     * 4. the lottery should be in the OPEN state
     */
    function checkUpkeep(
        bytes memory /* checkData */
    )
        public
        view
        override
        returns (
            bool upkeepNeeded,
            bytes memory /* performData */
        )
    {
        bool isOpen = RaffleState.OPEN == s_raffleState;
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval); //check to see if enough time has passed
        bool hasPlayers = s_players.length > 0;
        bool hasBalance = address(this).balance > 0;
        bool upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers);
        return (upkeepNeeded, "0x0"); // this does not need to be bool becuase it is declared a bool in the returns section
    }

    function performUpkeep(
        bytes calldata /*performData*/
    ) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffke__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        //external functions are cheeper than public becuase solidity knows we can't call it
        //we run the requestRandomWords funtion to start the requesting prosses
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords( //weird syntax because we are setting a var to what a funtion returns
            i_gasLane, //this is the KeyHash which is the maximum gas price you are wiling to pay for a request in wei.
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRaffleWinner(requestId);
    }

    function fulfillRandomWords(
        uint256, /*requestId*/
        uint256[] memory randomWords //fufillRandomWords is a funtion inherited from VRFConsumerBaseV2
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0); //resets array to a new address payable array of size(0)
        s_lastTimeStamp = block.timestamp;
        (bool sucsess, ) = recentWinner.call{value: address(this).balance}("");
        if (!sucsess) {
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    /* Veiw / Pure functions */
    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayers(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS; //because NUM_WORDS is in the bytecode it is not reading from storage so this funtion can be pure
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }
}
//emited to data storage outside of Raffle.sol
//14:25
