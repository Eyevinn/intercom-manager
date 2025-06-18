import { IngestIOManager } from './ingest_io_manager';
import { IngestIO, NewIngestIO } from './models';

const newIngestIO: NewIngestIO = {
  label: 'ingestIOlabel',
  ingestId: 1,
  deviceInput: {
    name: 'deviceinputname',
    label: 'deviceinputlabel'
  },
  deviceOutput: {
    name: 'deviceoutputname',
    label: 'deviceoutputlabel'
  },
  productionId: 'prod123',
  lineId: 'line456'
};

const existingIngestIO: IngestIO = {
  _id: 1,
  label: 'ingestIOlabel',
  ingestId: 1,
  deviceInput: {
    name: 'deviceinputname',
    label: 'deviceinputlabel'
  },
  deviceOutput: {
    name: 'deviceoutputname',
    label: 'deviceoutputlabel'
  },
  productionId: 'prod123',
  lineId: 'line456'
};

jest.mock('./db/interface', () => ({
  addIngestIO: jest.fn(),
  deleteIngestIO: jest.fn(),
  getIngestIO: jest.fn(),
  getIngestIOs: jest.fn(),
  getIngestIOsLength: jest.fn(),
  updateIngestIO: jest.fn(),
  connect: jest.fn()
}));

const deepClone = (obj: IngestIO) => JSON.parse(JSON.stringify(obj));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ingest_io_manager', () => {
  it('calls the dbManager when you try to create an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.addIngestIO
      .mockReturnValueOnce(undefined)
      .mockReturnValue(newIngestIO);

    const ingestIOManagerTest = new IngestIOManager(dbManager);

    const spyAddIngestIO = jest.spyOn(dbManager, 'addIngestIO');

    await ingestIOManagerTest.createIO(newIngestIO);
    expect(spyAddIngestIO).toHaveBeenCalledTimes(1);
  });
});

describe('ingest_io_manager', () => {
  it('creates ingest IO object then gets entire ingest IOs list from class instance', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(undefined);
    dbManager.getIngestIOs
      .mockReturnValueOnce([])
      .mockReturnValueOnce([existingIngestIO]);

    const ingestIOManagerTest = new IngestIOManager(dbManager);

    expect(await ingestIOManagerTest.getIngestIOs()).toStrictEqual([]);
    expect(await ingestIOManagerTest.getIngestIOs()).toStrictEqual([
      existingIngestIO
    ]);
  });
});

describe('ingest_io_manager', () => {
  it('getting a non existent ingest IO object returns undefined', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(undefined);

    const ingestIOManagerTest = new IngestIOManager(dbManager);

    const nonExistentIngestIO = await ingestIOManagerTest.getIngestIO(-1);
    expect(nonExistentIngestIO).toStrictEqual(undefined);
  });
});

describe('ingest_io_manager', () => {
  it('deleting ingest IO object removes it from class instance', async () => {
    const ingestIO1: IngestIO = {
      _id: 1,
      label: 'ingestIOlabel1',
      ingestId: 1,
      deviceInput: {
        name: 'deviceinputname1',
        label: 'deviceinputlabel1'
      },
      deviceOutput: {
        name: 'deviceoutputname1',
        label: 'deviceoutputlabel1'
      },
      productionId: 'prod123',
      lineId: 'line456'
    };

    const ingestIO2: IngestIO = {
      _id: 2,
      label: 'ingestIOlabel2',
      ingestId: 2,
      deviceInput: {
        name: 'deviceinputname2',
        label: 'deviceinputlabel2'
      },
      deviceOutput: {
        name: 'deviceoutputname2',
        label: 'deviceoutputlabel2'
      },
      productionId: 'prod789',
      lineId: 'line012'
    };

    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);
    dbManager.getIngestIOs
      .mockReturnValueOnce([ingestIO1, ingestIO2])
      .mockReturnValueOnce([ingestIO2]);
    dbManager.deleteIngestIO.mockReturnValueOnce(true);

    const ingestIOManagerTest = new IngestIOManager(dbManager);

    expect(await ingestIOManagerTest.getIngestIOs()).toStrictEqual([
      ingestIO1,
      ingestIO2
    ]);
    expect(await ingestIOManagerTest.deleteIngestIO(1)).toStrictEqual(true);
    expect(await ingestIOManagerTest.getIngestIOs()).toStrictEqual([ingestIO2]);
  });
});

describe('ingest_io_manager', () => {
  it('deleting a non existent ingest IO object returns false', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIOs.mockReturnValueOnce([]);
    dbManager.deleteIngestIO
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const ingestIOManagerTest = new IngestIOManager(dbManager);

    expect(await ingestIOManagerTest.deleteIngestIO(1)).toStrictEqual(true);
    expect(await ingestIOManagerTest.getIngestIOs()).toStrictEqual([]);
    expect(await ingestIOManagerTest.deleteIngestIO(1)).toStrictEqual(false);
  });
});

describe('ingest_io_manager', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('change the label of a device output in an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(deepClone(existingIngestIO));
    const ingestIOManagerTest = new IngestIOManager(dbManager);
    const ingestIO = await ingestIOManagerTest.getIngestIO(1);
    if (ingestIO) {
      await ingestIOManagerTest.updateIngestIO(ingestIO, {
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'newLabel'
        }
      });
      expect(dbManager.updateIngestIO).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestIOlabel',
        ingestId: 1,
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'newLabel'
        },
        deviceInput: {
          name: 'deviceinputname',
          label: 'deviceinputlabel'
        },
        productionId: 'prod123',
        lineId: 'line456'
      });
    }
  });

  it('change the label of a device input in an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(deepClone(existingIngestIO));
    const ingestIOManagerTest = new IngestIOManager(dbManager);
    const ingestIO = await ingestIOManagerTest.getIngestIO(1);
    if (ingestIO) {
      await ingestIOManagerTest.updateIngestIO(ingestIO, {
        deviceInput: {
          name: 'deviceinputname',
          label: 'newLabel'
        }
      });
      expect(dbManager.updateIngestIO).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestIOlabel',
        ingestId: 1,
        deviceInput: {
          name: 'deviceinputname',
          label: 'newLabel'
        },
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'deviceoutputlabel'
        },
        productionId: 'prod123',
        lineId: 'line456'
      });
    }
  });

  it('change the label of an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(deepClone(existingIngestIO));
    const ingestIOManagerTest = new IngestIOManager(dbManager);
    const ingestIO = await ingestIOManagerTest.getIngestIO(1);
    if (ingestIO) {
      await ingestIOManagerTest.updateIngestIO(ingestIO, {
        label: 'newLabel'
      });
      expect(dbManager.updateIngestIO).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'newLabel',
        ingestId: 1,
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'deviceoutputlabel'
        },
        deviceInput: {
          name: 'deviceinputname',
          label: 'deviceinputlabel'
        },
        productionId: 'prod123',
        lineId: 'line456'
      });
    }
  });

  it('change the productionId of an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(deepClone(existingIngestIO));
    const ingestIOManagerTest = new IngestIOManager(dbManager);
    const ingestIO = await ingestIOManagerTest.getIngestIO(1);
    if (ingestIO) {
      await ingestIOManagerTest.updateIngestIO(ingestIO, {
        productionId: 'newProd999'
      });
      expect(dbManager.updateIngestIO).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestIOlabel',
        ingestId: 1,
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'deviceoutputlabel'
        },
        deviceInput: {
          name: 'deviceinputname',
          label: 'deviceinputlabel'
        },
        productionId: 'newProd999',
        lineId: 'line456'
      });
    }
  });

  it('change the lineId of an ingest IO', async () => {
    const dbManager = jest.requireMock('./db/interface');
    dbManager.getIngestIO.mockReturnValueOnce(deepClone(existingIngestIO));
    const ingestIOManagerTest = new IngestIOManager(dbManager);
    const ingestIO = await ingestIOManagerTest.getIngestIO(1);
    if (ingestIO) {
      await ingestIOManagerTest.updateIngestIO(ingestIO, {
        lineId: 'newLine999'
      });
      expect(dbManager.updateIngestIO).toHaveBeenLastCalledWith({
        _id: 1,
        label: 'ingestIOlabel',
        ingestId: 1,
        deviceOutput: {
          name: 'deviceoutputname',
          label: 'deviceoutputlabel'
        },
        deviceInput: {
          name: 'deviceinputname',
          label: 'deviceinputlabel'
        },
        productionId: 'prod123',
        lineId: 'newLine999'
      });
    }
  });
});
