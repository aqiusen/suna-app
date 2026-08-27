export namespace main {
	
	export class PickedFile {
	    path: string;
	    name: string;
	    is_dir?: boolean;
	    mime_type?: string;
	    size?: number;
	
	    static createFrom(source: any = {}) {
	        return new PickedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.is_dir = source["is_dir"];
	        this.mime_type = source["mime_type"];
	        this.size = source["size"];
	    }
	}

}

