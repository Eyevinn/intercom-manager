import { IngestManager } from './ingest_manager';
import { Ingest, NewIngest } from './models';

const audioDevice = {
  name: 'device',
  maxInputChannels: 2,
  maxOutputChannels: 2,
  defaultSampleRate: 48000,
  defaultLowInputLatency: 0.01,
  defaultLowOutputLatency: 0.01,
  defaultHighInputLatency: 0.1,
  defaultHighOutputLatency: 0.1,
  isInput: true,
  isOutput: true,
  hostAPI: 'Core Audio',
  label: 'device label'
};

const newIngest: NewIngest = {
  label: 'ingestlabel',
  ipAddress: '127.0.0.1'
};

const existingIngest: Ingest = {
  _id: 1,
  label: 'ingestlabel',
  ipAddress: '127.0.0.1',
  deviceOutput: [audioDevice],
  deviceInput: [audioDevice]
};

jest.mock('./db/interface', () => ({
  addIngest: jest.fn(),
  deleteIngest: jest.fn(),
  getIngest: jest.fn(),
  getIngests: jest.fn(),
  updateIngest: jest.fn(),
  connect: jest.fn()
}));

const deepClone = (obj: any) => JSON.parse(JSON.stringify(obj));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ingest_manager', () => {
  it('calls the dbManager when you try to create an ingest', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.addIngest
      .mockReturnValueOnce(undefined)
      .mockReturnValue(newIngest);

    const ingestManagerTest = new IngestManager(dbManager);

    const spyAddIngest = jest.spyOn(dbManager, 'addIngest');

    await ingestManagerTest.createIngest(newIngest);
    expect(spyAddIngest).toHaveBeenCalledTimes(1);
  });

  it('creating an already existing ingest returns undefined', async () => {
    const dbManager = jest.requireMock('./db/interface');

    // Simulate success on first create
    dbManager.addIngest.mockResolvedValueOnce(existingIngest);

    // Simulate failure (e.g., duplicate) on second create
    dbManager.addIngest.mockResolvedValueOnce(undefined);

    const ingestManagerTest = new IngestManager(dbManager);

    const result1 = await ingestManagerTest.createIngest(newIngest);
    expect(result1).toEqual(existingIngest);

    const result2 = await ingestManagerTest.createIngest(newIngest);
    expect(result2).toBeUndefined();
  });

  it('creates ingest object then gets entire ingests list from class instance', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(undefined);
    dbManager.getIngests
      .mockReturnValueOnce([])
      .mockReturnValueOnce([existingIngest]);

    const ingestManagerTest = new IngestManager(dbManager);

    expect(await ingestManagerTest.getIngests()).toStrictEqual([]);
    await ingestManagerTest.createIngest(existingIngest);
    const ingests = await ingestManagerTest.getIngests();
    expect(ingests).toStrictEqual([existingIngest]);
  });

  it('getting a non existent ingest object returns undefined', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(undefined);

    const ingestManagerTest = new IngestManager(dbManager);

    const nonExistentIngest = await ingestManagerTest.getIngest(-1);
    expect(nonExistentIngest).toStrictEqual(undefined);
  });

  it('deleting ingest object removes it from class instance', async () => {
    const ingest1: Ingest = {
      _id: 1,
      label: 'ingestlabel1',
      ipAddress: '127.0.0.1',
      deviceOutput: [audioDevice],
      deviceInput: [audioDevice]
    };

    const ingest2: Ingest = {
      _id: 2,
      label: 'ingestlabel2',
      ipAddress: '127.0.0.2',
      deviceOutput: [audioDevice],
      deviceInput: [audioDevice]
    };

    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);
    dbManager.getIngests
      .mockReturnValueOnce([ingest1, ingest2])
      .mockReturnValueOnce([ingest2]);
    dbManager.deleteIngest.mockReturnValueOnce(true);

    const ingestManagerTest = new IngestManager(dbManager);

    expect(await ingestManagerTest.getIngests()).toStrictEqual([
      ingest1,
      ingest2
    ]);
    expect(await ingestManagerTest.deleteIngest(1)).toStrictEqual(true);
    expect(await ingestManagerTest.getIngests()).toStrictEqual([ingest2]);
  });

  it('deleting a non existent ingest object returns false', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngests.mockReturnValueOnce([]);
    dbManager.deleteIngest.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const ingestManagerTest = new IngestManager(dbManager);

    expect(await ingestManagerTest.deleteIngest(1)).toStrictEqual(true);
    expect(await ingestManagerTest.getIngests()).toStrictEqual([]);
    expect(await ingestManagerTest.deleteIngest(1)).toStrictEqual(false);
  });

  it('add an endpoint description to line connections', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(existingIngest);

    const ingestManagerTest = new IngestManager(dbManager);

    const ingest = await ingestManagerTest.getIngest(1);
    const ingestDeviceOutput = ingest?.deviceOutput;
    if (!ingestDeviceOutput) {
      fail('Test failed due to ingestDeviceOutput being undefined');
    }
  });

  it('change the label of a device output in an ingest', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(deepClone(existingIngest));
    const ingestManagerTest = new IngestManager(dbManager);
    const ingest = await ingestManagerTest.getIngest(1);
    if (ingest) {
      await ingestManagerTest.updateIngest(ingest, {
        deviceOutput: {
          ...audioDevice,
          label: 'newLabel'
        }
      });
      expect(dbManager.updateIngest).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestlabel',
        ipAddress: '127.0.0.1',
        deviceOutput: [
          {
            ...audioDevice,
            label: 'newLabel'
          }
        ],
        deviceInput: [audioDevice]
      });
    }
  });

  it('change the label of a device input in an ingest', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(deepClone(existingIngest));
    const ingestManagerTest = new IngestManager(dbManager);
    const ingest = await ingestManagerTest.getIngest(1);
    if (ingest) {
      await ingestManagerTest.updateIngest(ingest, {
        deviceInput: {
          ...audioDevice,
          label: 'newLabel'
        }
      });
      expect(dbManager.updateIngest).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestlabel',
        ipAddress: '127.0.0.1',
        deviceInput: [
          {
            ...audioDevice,
            label: 'newLabel'
          }
        ],
        deviceOutput: [audioDevice]
      });
    }
  });

  it('change the label of an ingest', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(deepClone(existingIngest));
    const ingestManagerTest = new IngestManager(dbManager);
    const ingest = await ingestManagerTest.getIngest(1);
    if (ingest) {
      await ingestManagerTest.updateIngest(ingest, {
        label: 'newLabel'
      });
      expect(dbManager.updateIngest).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'newLabel',
        ipAddress: '127.0.0.1',
        deviceOutput: [audioDevice],
        deviceInput: [audioDevice]
      });
    }
  });
});
