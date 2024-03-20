import {
  NewProduction,
  Production,
  Line,
  SmbEndpointDescription
} from './models';

export class ProductionManager {
  private productions: Production[];

  constructor() {
    this.productions = [];
  }

  createProduction(newProduction: NewProduction): Production | undefined {
    const productionId: string = (this.productions.length + 1).toString();
    if (!this.getProduction(productionId)) {
      const newProductionLines: Line[] = [];

      for (const line of newProduction.lines) {
        const newProductionLine: Line = {
          name: line.name,
          smbid: '',
          connections: {}
        };
        newProductionLines.push(newProductionLine);
      }

      const production: Production = {
        name: newProduction.name,
        productionid: productionId,
        lines: newProductionLines
      };
      if (production) {
        this.productions.push(production);
        return production;
      } else {
        throw new Error(
          `Create production failed, Production object error ${production}`
        );
      }
    } else {
      throw new Error(
        `Create production failed, Production ${newProduction} already exists`
      );
    }
  }

  getProductions(): Production[] {
    return this.productions;
  }

  getProduction(productionid: string): Production | undefined {
    const matchedProduction = this.productions.find(
      (production) => production.productionid === productionid
    );
    if (matchedProduction) {
      return matchedProduction;
    } else {
      return undefined;
    }
  }

  deleteProduction(productionName: string): string | undefined {
    const matchedProductionIndex: number = this.productions.findIndex(
      (production) => production.name === productionName
    );
    if (matchedProductionIndex != -1) {
      if (this.productions.splice(matchedProductionIndex, 1)) {
        return productionName;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  setLineId(
    productionid: string,
    lineName: string,
    lineSmbId: string
  ): Line | undefined {
    const matchedProduction = this.getProduction(productionid);
    if (matchedProduction) {
      const line = this.getLine(matchedProduction.lines, lineName);
      if (line) {
        line.smbid = lineSmbId;
        return line;
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  getLine(lines: Line[], lineName: string): Line | undefined {
    const matchedLine = lines.find((line) => line.name === lineName);
    if (matchedLine) {
      return matchedLine;
    }
    return undefined;
  }

  addConnectionToLine(
    productionId: string,
    lineName: string,
    userName: string,
    endpointDescription: SmbEndpointDescription,
    endpointId: string
  ): void {
    const production = this.getProduction(productionId);
    if (production) {
      const matchedLine = production.lines.find(
        (line) => line.name === lineName
      );
      if (matchedLine) {
        matchedLine.connections[userName] = {
          sessionDescription: endpointDescription,
          endpointId: endpointId
        };
      }
    } else {
      throw new Error(
        `Adding connection failed, Production ${productionId} does not exist`
      );
    }
  }

  removeConnectionFromLine(
    productionName: string,
    lineName: string,
    userName: string
  ): string | undefined {
    const production = this.getProduction(productionName);
    if (production) {
      const matchedLine = production.lines.find(
        (line) => line.name === lineName
      );
      if (matchedLine?.connections) {
        delete matchedLine.connections[userName];
        return userName;
      }
    } else {
      throw new Error(
        `Deleting connection failed, Production ${productionName} does not exist`
      );
    }
  }
}
