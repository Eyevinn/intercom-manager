import { IngestManager } from './ingest_manager';
import { Ingest, NewIngest } from './models';

const newIngest: NewIngest = {
  label: 'ingestlabel',
  ipAddress: '127.0.0.1'
};

const existingIngest: Ingest = {
  _id: 1,
  label: 'ingestlabel',
  ipAddress: '127.0.0.1',
  deviceOutput: [
    {
      name: 'deviceoutputname',
      label: 'deviceoutputlabel'
    }
  ],
  deviceInput: [
    {
      name: 'deviceinputname',
      label: 'deviceinputlabel'
    }
  ]
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
});

describe('ingest_manager', () => {
  it('creating an already existing ingest throws error', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.addIngest
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(newIngest)
      .mockReturnValueOnce(existingIngest);

    const ingestManagerTest = new IngestManager(dbManager);

    await ingestManagerTest.createIngest(newIngest);

    () => {
      expect(async () => {
        await ingestManagerTest.createIngest(newIngest);
      }).toThrow();
    };
  });
});

describe('ingest_manager', () => {
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
});

describe('ingest_manager', () => {
  it('getting a non existent ingest object returns undefined', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngest.mockReturnValueOnce(undefined);

    const ingestManagerTest = new IngestManager(dbManager);

    const nonExistentIngest = await ingestManagerTest.getIngest(-1);
    expect(nonExistentIngest).toStrictEqual(undefined);
  });
});

describe('ingest_manager', () => {
  it('deleting ingest object removes it from class instance', async () => {
    const ingest1: Ingest = {
      _id: 1,
      label: 'ingestlabel1',
      ipAddress: '127.0.0.1',
      deviceOutput: [
        {
          name: 'deviceoutputname1',
          label: 'deviceoutputlabel1'
        }
      ],
      deviceInput: [
        {
          name: 'deviceinputname1',
          label: 'deviceinputlabel1'
        }
      ]
    };

    const ingest2: Ingest = {
      _id: 2,
      label: 'ingestlabel2',
      ipAddress: '127.0.0.2',
      deviceOutput: [
        {
          name: 'deviceoutputname2',
          label: 'deviceoutputlabel2'
        }
      ],
      deviceInput: [
        {
          name: 'deviceinputname2',
          label: 'deviceinputlabel2'
        }
      ]
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
});

describe('ingest_manager', () => {
  it('deleting a non existent ingest object returns false', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngests.mockReturnValueOnce([]);
    dbManager.deleteIngest.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const ingestManagerTest = new IngestManager(dbManager);

    expect(await ingestManagerTest.deleteIngest(1)).toStrictEqual(true);
    expect(await ingestManagerTest.getIngests()).toStrictEqual([]);
    expect(await ingestManagerTest.deleteIngest(1)).toStrictEqual(false);
  });
});

describe('ingest_manager', () => {
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

  describe('ingest_manager', () => {
    beforeEach(() => {
      jest.resetAllMocks();
    });

    it('change the label of a device output in an ingest', async () => {
      const dbManager = jest.requireMock('./db/interface');
      dbManager.getIngest.mockReturnValueOnce(deepClone(existingIngest));
      const ingestManagerTest = new IngestManager(dbManager);
      const ingest = await ingestManagerTest.getIngest(1);
      if (ingest) {
        await ingestManagerTest.updateIngest(ingest, {
          deviceOutput: {
            name: 'deviceoutputname',
            label: 'newLabel'
          }
        });
        expect(dbManager.updateIngest).toHaveBeenLastCalledWith({
          _id: 1,
          label: 'ingestlabel',
          ipAddress: '127.0.0.1',
          deviceOutput: [
            {
              name: 'deviceoutputname',
              label: 'newLabel'
            }
          ],
          deviceInput: [
            {
              name: 'deviceinputname',
              label: 'deviceinputlabel'
            }
          ]
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
            name: 'deviceinputname',
            label: 'newLabel'
          }
        });
        expect(dbManager.updateIngest).toHaveBeenLastCalledWith({
          _id: 1,
          label: 'ingestlabel',
          ipAddress: '127.0.0.1',
          deviceInput: [
            {
              name: 'deviceinputname',
              label: 'newLabel'
            }
          ],
          deviceOutput: [
            {
              name: 'deviceoutputname',
              label: 'deviceoutputlabel'
            }
          ]
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
          deviceOutput: [
            {
              name: 'deviceoutputname',
              label: 'deviceoutputlabel'
            }
          ],
          deviceInput: [
            {
              name: 'deviceinputname',
              label: 'deviceinputlabel'
            }
          ]
        });
      }
    });
  });
});
