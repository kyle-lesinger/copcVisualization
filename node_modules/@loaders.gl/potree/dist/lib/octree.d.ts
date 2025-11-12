export declare class PointCloudOctree {
    constructor();
}
export declare class PointCloudOctant {
    constructor(name: any, octree: any, boundingBox: any);
    isGeometryNode(): boolean;
    getLevel(): any;
    isTreeNode(): boolean;
    isLoaded(): any;
    getBoundingSphere(): any;
    getBoundingBox(): any;
    getChildren(): any;
    getURL(): string;
    getHierarchyPath(): string;
    addChild(child: any): void;
    load(): void;
    loadPoints(): void;
    loadHierachyThenPoints(): void;
    getNumPoints(): any;
    dispose(): void;
}
//# sourceMappingURL=octree.d.ts.map