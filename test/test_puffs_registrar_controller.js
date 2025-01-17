const ENS = artifacts.require('@ensdomains/ens/ENSRegistry');
const HashRegistrar = artifacts.require('@ensdomains/ens/HashRegistrar');
const BaseRegistrar = artifacts.require('./BaseRegistrarImplementation');
const PUFFSRegistrarController = artifacts.require('./PUFFSRegistrarController');
const SimplePriceOracle = artifacts.require('./SimplePriceOracle');
var Promise = require('bluebird');

const namehash = require('puffs-ens-namehash');
const sha3 = require('web3-utils').sha3;
const toBN = require('web3-utils').toBN;

const DAYS = 24 * 60 * 60;
const SALT = sha3('foo');

const advanceTime = Promise.promisify(function(delay, done) {
	web3.currentProvider.send({
		jsonrpc: "2.0",
		"method": "evm_increaseTime",
		params: [delay]}, done)
	}
);

async function expectFailure(call) {
	let tx;
	try {
		tx = await call;
	} catch (error) {
		// Assert ganache revert exception
		assert.equal(
			error.message,
			'Returned error: VM Exception while processing transaction: revert'
		);
	}
	if(tx !== undefined) {
		assert.equal(parseInt(tx.receipt.status), 0);
	}
}

contract('PUFFSRegistrarController', function (accounts) {
	let ens;
	let baseRegistrar;
	let interimRegistrar;
	let controller;
	let priceOracle;

	const secret = "0x0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
	const ownerAccount = accounts[0]; // Account that owns the registrar
	const registrantAccount = accounts[1]; // Account that owns test names

	async function registerOldNames(names) {
		var hashes = names.map(sha3);
		var value = toBN(10000000000000000);
		var bidHashes = await Promise.map(hashes, (hash) => interimRegistrar.shaBid(hash, accounts[0], value, SALT));
		await interimRegistrar.startAuctions(hashes);
		await Promise.map(bidHashes, (h) => interimRegistrar.newBid(h, {value: value}));
		await advanceTime(3 * DAYS + 1);
		await Promise.map(hashes, (hash) => interimRegistrar.unsealBid(hash, value, SALT));
		await advanceTime(2 * DAYS + 1);
		await Promise.map(hashes, (hash) => interimRegistrar.finalizeAuction(hash));
		for(var name of names) {
			assert.equal(await ens.owner(namehash.hash(name + '.puffs')), accounts[0]);
		}
	}

	before(async () => {
		ens = await ENS.new();

		interimRegistrar = await HashRegistrar.new(ens.address, namehash.hash('puffs'), 1493895600);
		await ens.setSubnodeOwner('0x0', sha3('puffs'), interimRegistrar.address);
		await registerOldNames(['name', 'name2'], registrantAccount);

		const now = (await web3.puffs.getBlock('latest')).timestamp;
		baseRegistrar = await BaseRegistrar.new(ens.address, interimRegistrar.address, namehash.hash('puffs'), now + 365 * DAYS, {from: ownerAccount});
		await ens.setSubnodeOwner('0x0', sha3('eth'), baseRegistrar.address);

		priceOracle = await SimplePriceOracle.new(1);
		controller = await PUFFSRegistrarController.new(
			baseRegistrar.address,
			priceOracle.address,
			600,
			86400,
			{from: ownerAccount});
			await baseRegistrar.addController(controller.address, {from: ownerAccount});
		});

		it('should report unused names as available', async () => {
			assert.equal(await controller.available(sha3('available')), true);
		});

		it('should report registered names as unavailable', async () => {
			assert.equal(await controller.available('name'), false);
		});

		it('should permit new registrations', async () => {
			var commitment = await controller.makeCommitment("newname", registrantAccount, secret);
			var tx = await controller.commit(commitment);
			assert.equal(await controller.commitments(commitment), (await web3.puffs.getBlock(tx.receipt.blockNumber)).timestamp);

			await advanceTime((await controller.minCommitmentAge()).toNumber());
			var balanceBefore = await web3.puffs.getBalance(controller.address);
			var tx = await controller.register("newname", registrantAccount, 28 * DAYS, secret, {value: 28 * DAYS + 1, gasPrice: 0});
			assert.equal(tx.logs.length, 1);
			assert.equal(tx.logs[0].event, "NameRegistered");
			assert.equal(tx.logs[0].args.name, "newname");
			assert.equal(tx.logs[0].args.owner, registrantAccount);
			assert.equal((await web3.puffs.getBalance(controller.address)) - balanceBefore, 28 * DAYS);
		});

		it('should include the owner in the commitment', async () => {
			await controller.commit(await controller.makeCommitment("newname2", accounts[2], secret));

			await advanceTime((await controller.minCommitmentAge()).toNumber());
			var balanceBefore = await web3.puffs.getBalance(controller.address);
			await expectFailure(controller.register("newname2", registrantAccount, 28 * DAYS, secret, {value: 28 * DAYS, gasPrice: 0}));
		});

		it('should reject duplicate registrations', async () => {
			await controller.commit(await controller.makeCommitment("newname", registrantAccount, secret));

			await advanceTime((await controller.minCommitmentAge()).toNumber());
			var balanceBefore = await web3.puffs.getBalance(controller.address);
			await expectFailure(controller.register("newname", registrantAccount, 28 * DAYS, secret, {value: 28 * DAYS, gasPrice: 0}));
		});

		it('should reject for expired commitments', async () => {
			await controller.commit(await controller.makeCommitment("newname2", registrantAccount, secret));

			await advanceTime((await controller.maxCommitmentAge()).toNumber() + 1);
			var balanceBefore = await web3.puffs.getBalance(controller.address);
			await expectFailure(controller.register("newname2", registrantAccount, 28 * DAYS, secret, {value: 28 * DAYS, gasPrice: 0}));
		});

		it('should allow anyone to renew a name', async () => {
			var expires = await baseRegistrar.nameExpires(sha3("newname"));
			var balanceBefore = await web3.puffs.getBalance(controller.address);
			await controller.renew("newname", 86400, {value: 86400 + 1});
			var newExpires = await baseRegistrar.nameExpires(sha3("newname"));
			assert.equal(newExpires.toNumber() - expires.toNumber(), 86400);
			assert.equal((await web3.puffs.getBalance(controller.address)) - balanceBefore, 86400);
		});

		it('should require sufficient value for a renewal', async () => {
			await expectFailure(controller.renew("name", 86400));
		});

		it('should allow the registrar owner to withdraw funds', async () => {
			await controller.withdraw({gasPrice: 0, from: ownerAccount});
			assert.equal(await web3.puffs.getBalance(controller.address), 0);
		});
	});
