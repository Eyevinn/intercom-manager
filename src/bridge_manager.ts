import { DbManager } from './db/interface';
import { Log } from './log';
import { BridgeStatus } from './models';
import { BridgeDriver } from './bridge/driver';

// The bridge reconcile loop runs every second and logs per transmitter /
// receiver, which floods the terminal. Gate that verbose output behind its own
// flag so it stays quiet even when DEBUG (used by other diagnostic logs) is on.
// Set DEBUG_BRIDGE=true to re-enable it.
const bridgeDebug = (...args: unknown[]): void => {
  if (process.env.DEBUG_BRIDGE === 'true') Log().debug(...args);
};

export class BridgeManager {
  private dbManager: DbManager;
  private driver: BridgeDriver;
  private syncInterval?: NodeJS.Timeout;
  private syncIntervalMs = 1000; // 1 second

  constructor(dbManager: DbManager, driver: BridgeDriver) {
    this.dbManager = dbManager;
    this.driver = driver;
  }

  // Start the sync service
  start() {
    Log().info('Starting bridge manager sync service');
    this.syncInterval = setInterval(() => {
      this.syncAll().catch((error) => {
        Log().error('Error during bridge sync:', error);
      });
    }, this.syncIntervalMs);

    // Run initial sync
    this.syncAll().catch((error) => {
      Log().error('Error during initial bridge sync:', error);
    });
  }

  // Stop the sync service
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
      Log().info('Stopped bridge manager sync service');
    }
  }

  // Sync all transmitters and receivers
  async syncAll() {
    const tasks: Promise<void>[] = [];
    if (this.driver.transmittersEnabled) {
      tasks.push(this.syncTransmitters());
    }
    if (this.driver.receiversEnabled) {
      tasks.push(this.syncReceivers());
    }
    await Promise.all(tasks);
  }

  // Sync transmitters with gateway
  private async syncTransmitters() {
    try {
      // Get all transmitters from database
      const dbTransmitters = await this.dbManager.getTransmitters(1000, 0);

      // Get all transmitters from gateway
      let gatewayTransmitters: any[] = [];
      try {
        gatewayTransmitters = (await this.driver.listTransmitters()) || [];
      } catch (error) {
        Log().warn('Failed to fetch transmitters from gateway:', error);
        // Mark all as failed if gateway is unreachable
        for (const tx of dbTransmitters) {
          if (tx.status !== BridgeStatus.FAILED) {
            tx.status = BridgeStatus.FAILED;
            await this.dbManager.updateTransmitter(tx);
          }
        }
        return;
      }

      // Create a map of gateway transmitters by their ID for quick lookup
      const gatewayTxMap = new Map(
        gatewayTransmitters.map((t: any) => [t.id, t])
      );

      // Sync each database transmitter
      for (const dbTx of dbTransmitters) {
        const existsOnGateway = gatewayTxMap.has(dbTx._id);

        if (!existsOnGateway) {
          // Transmitter missing from gateway - recreate it
          try {
            // Use desiredStatus if set, otherwise use current status
            const statusToUse = dbTx.desiredStatus || dbTx.status;

            await this.driver.createTransmitter(dbTx, statusToUse);
            Log().info(
              `Recreated transmitter on gateway: port ${dbTx.port} with status ${statusToUse}`
            );

            // Update status to match what was set on gateway
            if (dbTx.status !== statusToUse) {
              dbTx.status = statusToUse;
              await this.dbManager.updateTransmitter(dbTx);
            }
          } catch (error) {
            const errorMessage = (error as Error).message || String(error);

            // If transmitter already exists, try to delete and recreate
            if (errorMessage.includes('already exists')) {
              Log().warn(
                `Transmitter ${dbTx._id} already exists on gateway from previous run, removing and recreating`
              );
              try {
                // Delete the stale transmitter
                await this.driver.deleteTransmitter(dbTx._id);

                // Retry creation
                const statusToUse = dbTx.desiredStatus || dbTx.status;

                await this.driver.createTransmitter(dbTx, statusToUse);
                Log().info(
                  `Successfully recreated transmitter after cleanup: port ${dbTx.port}`
                );

                // Update status
                if (dbTx.status !== statusToUse) {
                  dbTx.status = statusToUse;
                  await this.dbManager.updateTransmitter(dbTx);
                }
              } catch (retryError) {
                Log().error(
                  `Failed to recreate transmitter after cleanup: port ${dbTx.port}`,
                  retryError
                );
                if (dbTx.status !== BridgeStatus.FAILED) {
                  dbTx.status = BridgeStatus.FAILED;
                  await this.dbManager.updateTransmitter(dbTx);
                }
              }
            } else {
              Log().error(
                `Failed to recreate transmitter on gateway: port ${dbTx.port}`,
                error
              );
              if (dbTx.status !== BridgeStatus.FAILED) {
                dbTx.status = BridgeStatus.FAILED;
                await this.dbManager.updateTransmitter(dbTx);
              }
            }
          }
        } else {
          // Transmitter exists - check if desired state differs from actual
          const gatewayTx = gatewayTxMap.get(dbTx._id);

          if (gatewayTx) {
            // If desiredStatus is set and differs from gateway state, enforce it
            if (dbTx.desiredStatus && dbTx.desiredStatus !== gatewayTx.status) {
              bridgeDebug(
                `Transmitter port ${dbTx.port} - Enforcing state change: gateway="${gatewayTx.status}" db="${dbTx.status}" desired="${dbTx.desiredStatus}"`
              );
              try {
                await this.driver.setTransmitterState(
                  dbTx._id,
                  dbTx.desiredStatus
                );
                bridgeDebug(
                  `Transmitter port ${dbTx.port} - Successfully enforced desired state: "${dbTx.desiredStatus}"`
                );

                // Update actual status to match desired
                dbTx.status = dbTx.desiredStatus;
                await this.dbManager.updateTransmitter(dbTx);
              } catch (error) {
                Log().error(
                  `Transmitter port ${dbTx.port} - Failed to enforce desired state "${dbTx.desiredStatus}" (will retry):`,
                  error
                );
              }
            } else if (gatewayTx.status !== dbTx.status) {
              // No desired state set, just sync with gateway
              bridgeDebug(
                `Transmitter port ${dbTx.port} - Syncing from gateway: "${dbTx.status}" -> "${gatewayTx.status}"`
              );
              dbTx.status = gatewayTx.status;
              await this.dbManager.updateTransmitter(dbTx);
            }
          }
        }
      }

      // Remove orphaned transmitters from gateway (not in database)
      const dbIdSet = new Set(dbTransmitters.map((t) => t._id));
      for (const gatewayTx of gatewayTransmitters) {
        if (!dbIdSet.has(gatewayTx.id)) {
          try {
            // Stop transmitter first before deleting
            try {
              await this.driver.setTransmitterState(
                gatewayTx.id,
                BridgeStatus.STOPPED
              );
            } catch (stopError) {
              Log().warn(
                `Failed to stop orphaned transmitter before deletion: id ${gatewayTx.id}`,
                stopError
              );
            }

            // Now delete the transmitter
            await this.driver.deleteTransmitter(gatewayTx.id);
            Log().info(
              `Removed orphaned transmitter from gateway: id ${gatewayTx.id}`
            );
          } catch (error) {
            Log().warn(
              `Failed to remove orphaned transmitter from gateway: id ${gatewayTx.id}`,
              error
            );
          }
        }
      }
    } catch (error) {
      Log().error('Error syncing transmitters:', error);
    }
  }

  // Sync receivers with gateway
  private async syncReceivers() {
    try {
      // Get all receivers from database
      const dbReceivers = await this.dbManager.getReceivers(1000, 0);

      // Get all receivers from gateway
      let gatewayReceivers: any[] = [];
      try {
        gatewayReceivers = (await this.driver.listReceivers()) || [];
      } catch (error) {
        Log().warn('Failed to fetch receivers from gateway:', error);
        // Mark all as failed if gateway is unreachable
        for (const rx of dbReceivers) {
          if (rx.status !== BridgeStatus.FAILED) {
            rx.status = BridgeStatus.FAILED;
            await this.dbManager.updateReceiver(rx);
          }
        }
        return;
      }

      const gatewayIdSet = new Set(gatewayReceivers.map((r: any) => r.id));

      // Sync each database receiver
      for (const dbRx of dbReceivers) {
        const existsOnGateway = gatewayIdSet.has(dbRx._id);

        if (!existsOnGateway) {
          // Receiver missing from gateway - recreate it
          try {
            // Use desiredStatus if set, otherwise use current status
            const statusToUse = dbRx.desiredStatus || dbRx.status;

            await this.driver.createReceiver(dbRx, statusToUse);
            Log().info(
              `Recreated receiver on gateway: id ${dbRx._id} with status ${statusToUse}`
            );

            // Update status to match what was set on gateway
            if (dbRx.status !== statusToUse) {
              dbRx.status = statusToUse;
              await this.dbManager.updateReceiver(dbRx);
            }
          } catch (error) {
            Log().error(
              `Failed to recreate receiver on gateway: id ${dbRx._id}`,
              error
            );
            if (dbRx.status !== BridgeStatus.FAILED) {
              dbRx.status = BridgeStatus.FAILED;
              await this.dbManager.updateReceiver(dbRx);
            }
          }
        } else {
          // Receiver exists - check if desired state differs from actual
          const gatewayRx = gatewayReceivers.find(
            (r: any) => r.id === dbRx._id
          );

          if (gatewayRx) {
            // If desiredStatus is set and differs from gateway state, enforce it
            if (dbRx.desiredStatus && dbRx.desiredStatus !== gatewayRx.status) {
              bridgeDebug(
                `Receiver ${dbRx._id} - Enforcing state change: gateway="${gatewayRx.status}" db="${dbRx.status}" desired="${dbRx.desiredStatus}"`
              );
              try {
                await this.driver.setReceiverState(
                  dbRx._id,
                  dbRx.desiredStatus
                );
                bridgeDebug(
                  `Receiver ${dbRx._id} - Successfully enforced desired state: "${dbRx.desiredStatus}"`
                );

                // Update actual status to match desired
                dbRx.status = dbRx.desiredStatus;
                await this.dbManager.updateReceiver(dbRx);
              } catch (error) {
                Log().error(
                  `Receiver ${dbRx._id} - Failed to enforce desired state "${dbRx.desiredStatus}" (will retry):`,
                  error
                );
              }
            } else if (gatewayRx.status !== dbRx.status) {
              // No desired state set, just sync with gateway
              bridgeDebug(
                `Receiver ${dbRx._id} - Syncing from gateway: "${dbRx.status}" -> "${gatewayRx.status}"`
              );
              dbRx.status = gatewayRx.status;
              await this.dbManager.updateReceiver(dbRx);
            }
          }
        }
      }

      // Remove orphaned receivers from gateway (not in database)
      const dbIdSet = new Set(dbReceivers.map((r) => r._id));
      for (const gatewayRx of gatewayReceivers) {
        if (!dbIdSet.has(gatewayRx.id)) {
          try {
            // Stop receiver first before deleting
            try {
              await this.driver.setReceiverState(
                gatewayRx.id,
                BridgeStatus.STOPPED
              );
            } catch (stopError) {
              Log().warn(
                `Failed to stop orphaned receiver before deletion: id ${gatewayRx.id}`,
                stopError
              );
            }

            // Now delete the receiver
            await this.driver.deleteReceiver(gatewayRx.id);
            Log().info(
              `Removed orphaned receiver from gateway: id ${gatewayRx.id}`
            );
          } catch (error) {
            Log().warn(
              `Failed to remove orphaned receiver from gateway: id ${gatewayRx.id}`,
              error
            );
          }
        }
      }
    } catch (error) {
      Log().error('Error syncing receivers:', error);
    }
  }
}
