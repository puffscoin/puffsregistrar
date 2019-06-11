# Puffs Registrar

Implements an ENS registrar intended for the .puffs TLD.

## Contracts

The registrar is separated into several components for simplicity, modularity, and privilege minimisation.

### [BaseRegistrar](https://github.com/puffscoin/puffsregistrar/blob/master/contracts/BaseRegistrarImplementation.sol)

BaseRegistrar is the contract that owns the TLD in the Puffscoin-NS registry. This contract implements a minimal set of functionality:

 - The owner of the registrar may add and remove controllers.
 - Controllers may register new domains and extend the expiry of (i.e.:renew) existing domains. They can not change the ownership or reduce the expiration time of existing domains.
 - Name owners may transfer ownership to another address.
 - Name owners may reclaim ownership of that name in the Puffscoin-ENS registry if they have lost it.

This separation of concerns provides name owners strong guarantees over continued ownership of their existing names, while still permitting innovation and change in the way names are registered and renewed via the controller mechanism.

### [PuffsRegistrarController](https://github.com/puffscoin/puffsregistrar/blob/master/contracts/PUFFSRegistrarController.sol)

PuffsRegistrarController is the first implementation of a registration controller for the new registrar. This contract implements the following functionality:

 - The owner of the registrar may set a price oracle contract, which determines the cost of registrations and renewals based on the name and the desired registration or renewal duration.
 - The owner of the registrar may withdraw any collected funds to their account.
 - Users can register new names using a commit/reveal process and by paying the appropriate registration fee.
 - Users can renew a name by paying the appropriate fee. Any user may renew a domain, not just the name's owner.

The commit/reveal process is used to avoid frontrunning, and operates as follows:

 1. A user commits to a hash, the preimage of which contains the name to be registered and a secret value.
 2. After a minimum delay period and before the commitment expires, the user calls the register function with the name to register and the secret value from the commitment. If a valid commitment is found and the other preconditions are met, the name is registered.

The minimum delay and expiry for commitments exist to prevent miners or other users from effectively frontrunnig registrations.

### [SimplePriceOracle](https://github.com/puffscoin/puffsregistrar/blob/master/contracts/SimplePriceOracle.sol)

SimplePriceOracle is a trivial implementation of the pricing oracle for the PuffsRegistrarController that always returns a fixed price per domain per year, determined by the contract owner.

### [StablePriceOracle](https://github.com/puffscoin/puffsregistrar/blob/master/contracts/StablePriceOracle.sol)

StablePriceOracle is a price oracle implementation that allows the contract owner to specify pricing based on the length of a name, and uses a fiat currency oracle to set a fixed price in fiat per name.
