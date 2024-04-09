import { CoreFunctions } from './api_productions_core_functions';
import {
  Line,
  LineResponse,
  NewProduction,
  Production,
  ProductionResponse
} from './models';
import { ProductionManager } from './production_manager';

export class ResponseFunctions {
  private productionManager: ProductionManager;
  private coreFunctions: CoreFunctions;

  constructor(
    productionManager: ProductionManager,
    coreFunctions: CoreFunctions
  ) {
    this.productionManager = productionManager;
    this.coreFunctions = coreFunctions;
  }

  makeCreateProductionResponse(
    NewProductionRequest: NewProduction
  ): ProductionResponse | undefined {
    const production: Production | undefined =
      this.productionManager.createProduction(NewProductionRequest);
    if (production) {
      const productionResponse: ProductionResponse = {
        name: production.name,
        productionid: production.productionid
      };
      return productionResponse;
    }
    return undefined;
  }

  makeGetProductionResponse(productionId: string): ProductionResponse {
    const production: Production =
      this.coreFunctions.getProduction(productionId);
    const productionLineList: string[] = [];
    for (const line of production.lines) {
      productionLineList.push(line.name);
    }
    const productionResponse: ProductionResponse = {
      name: production.name,
      productionid: production.productionid,
      linesnamelist: productionLineList
    };
    return productionResponse;
  }

  makeGetAllProductionsResponse(): ProductionResponse[] {
    const productions: Production[] = this.productionManager.getProductions();
    const productionsResponse: ProductionResponse[] = [];
    for (let i = 0; i < Math.min(productions.length, 50); i++) {
      const production = productions[i];
      productionsResponse.push({
        name: production.name,
        productionid: production.productionid
      });
    }
    return productionsResponse;
  }

  makeGetAllLinesInProductionResponse(productionId: string): LineResponse[] {
    const production: Production =
      this.coreFunctions.getProduction(productionId);
    const linesResponse: LineResponse[] = [];
    for (let i = 0; i < Math.min(production.lines.length, 50); i++) {
      const line = production.lines[i];
      linesResponse.push({
        name: line.name,
        id: line.id,
        smbconferenceid: line.smbid,
        participants: line.users.users
      });
    }
    return linesResponse;
  }

  makeGetLineInProductionResponse(
    productionId: string,
    lineId: string
  ): LineResponse {
    const line: Line = this.coreFunctions.retrieveLineFromProduction(
      productionId,
      lineId
    );
    const lineResponse: LineResponse = {
      name: line.name,
      id: line.id,
      smbconferenceid: line.smbid,
      participants: line.users.users
    };
    return lineResponse;
  }
}
